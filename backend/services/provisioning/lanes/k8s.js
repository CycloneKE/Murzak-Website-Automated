/**
 * Lane K - Kubernetes (the "scalable" capacity class).
 *
 * Implements the hybrid pipeline:
 * 1. Simulates/Triggers the build phase (e.g., via Coolify) to a private registry.
 * 2. Provisions the workload on a Kubernetes cluster via the native K8s API.
 *
 * Required env:
 *   KUBECONFIG_BASE64 (base64 encoded kubeconfig yaml) or local ~/.kube/config
 */

const k8s = require('@kubernetes/client-node');
const appDomain = require('../appDomain');

// We re-use some of the basic resource math from the coolify lane for consistency
// though in K8s we'll translate this to resource requests/limits.
const { resourceLimits } = require('./coolify');

function isConfigured(opts) {
  // Require a REAL, explicitly-provided kubeconfig. This lane has no cluster
  // behind it — the "or non-production NODE_ENV" fallback this used to have
  // graded the lane configured everywhere except prod with zero actual k8s
  // access, so readiness/enqueue could route a job here only to have
  // getKubeConfig()'s loadFromDefault() either find nothing or (worse) find
  // some unrelated local ~/.kube/config and act on it. Quarantined: only a
  // real KUBECONFIG_BASE64 makes this lane usable anywhere, prod or not.
  return !!process.env.KUBECONFIG_BASE64;
}

function configError(opts) {
  if (isConfigured(opts)) return null;
  return `Kubernetes lane not configured (missing: KUBECONFIG_BASE64)`;
}

function getKubeConfig() {
  const kc = new k8s.KubeConfig();
  if (process.env.KUBECONFIG_BASE64) {
    const yaml = Buffer.from(process.env.KUBECONFIG_BASE64, 'base64').toString('utf-8');
    kc.loadFromString(yaml);
  } else {
    kc.loadFromDefault();
  }
  return kc;
}

/** Safe, DNS-friendly resource name */
function resourceName(job) {
  return `${job.web_account}-${job.service_id}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * Get the image name to deploy. Refuses rather than fabricates: the hybrid
 * "build the repo via Coolify, push to our private registry" pipeline this
 * used to describe was never implemented — there is no registry and no
 * build step, so a repo_url job used to get a plausible-looking image URL
 * pointing at a container image that was never built. provision() would
 * then deploy a Deployment spec against that fake image (ImagePullBackOff
 * at best; silently resolving to an unrelated public image at worst, if
 * that registry hostname ever becomes real by accident). Only a job that
 * already names a real, pre-built image (job.docker_image, or the
 * documented nginx:alpine placeholder) is servable by this lane today.
 */
async function getContainerImage(job) {
  if (job.repo_url) {
    throw new Error(
      `k8s lane: no build pipeline exists for repo_url jobs (${job.web_account}/${job.service_id}) — ` +
        `refusing to fabricate a registry image URL. Provision this one manually, or set job.docker_image ` +
        `to a real, already-built image.`
    );
  }

  // Default fallback image if no repo provided (e.g. static site placeholder or specific service image)
  return job.docker_image || 'nginx:alpine';
}

/**
 * Provisions the resources in Kubernetes:
 * - Namespace (isolated per tenant)
 * - Deployment (the actual pods)
 * - Service (internal networking)
 */
async function provision(job, opts) {
  const name = resourceName(job);
  const namespace = `tenant-${job.web_account}`.toLowerCase();
  
  const limits = resourceLimits(job);
  const image = await getContainerImage(job);
  
  const kc = getKubeConfig();
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);
  
  // 1. Create or get Namespace
  try {
    await coreApi.readNamespace({ name: namespace });
  } catch (err) {
    if (err.statusCode === 404) {
      await coreApi.createNamespace({ body: { metadata: { name: namespace } } });
    } else {
      throw err;
    }
  }

  // 2. Create Deployment
  const deployment = {
    metadata: { name },
    spec: {
      replicas: job.replicas || 1, // Default to 1 replica initially
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: {
          containers: [{
            name: name,
            image: image,
            ports: [{ containerPort: job.app_port || 3000 }],
            resources: {
              requests: {
                memory: `${Math.max(limits.ramMb / 2, 64)}Mi`,
                cpu: `${Math.max(limits.cpus / 2, 0.1)}`
              },
              limits: {
                memory: `${limits.ramMb}Mi`,
                cpu: `${limits.cpus}`
              }
            },
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] }
            }
          }]
        }
      }
    }
  };

  try {
    await appsApi.createNamespacedDeployment({ namespace, body: deployment });
  } catch (err) {
    if (err.statusCode === 409) {
      // Already exists, we can patch it for idempotency
      await appsApi.patchNamespacedDeployment({
        name,
        namespace,
        body: deployment
      }, undefined, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } });
    } else {
      throw err;
    }
  }

  // 3. Create Service
  const service = {
    metadata: { name },
    spec: {
      selector: { app: name },
      ports: [{ port: 80, targetPort: job.app_port || 3000 }]
    }
  };

  try {
    await coreApi.createNamespacedService({ namespace, body: service });
  } catch (err) {
    if (err.statusCode !== 409) throw err; // Ignore if exists
  }

  // We are not attaching Ingress directly here, typically it's done via attachDomain 
  // or a default internal domain. We'll simulate a success.

  return {
    externalRef: `${namespace}/${name}`,
    access: {
      lane: "k8s",
      target: "k8s-cluster",
      resource: name,
      namespace: namespace,
      uuid: name,
    },
    log: `k8s: created deployment "${name}" in namespace "${namespace}" using image "${image}" with ${job.replicas || 1} replicas.`
  };
}

/**
 * Handle manual scaling and HPA (auto-scaling) configuration.
 */
async function scaleOut(externalRef, config) {
  const [namespace, name] = externalRef.split('/');
  const kc = getKubeConfig();
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);
  const autoscalingApi = kc.makeApiClient(k8s.AutoscalingV2Api);

  if (config.mode === 'auto') {
    // Create or Update HPA
    const hpa = {
      metadata: { name },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: name
        },
        minReplicas: config.minReplicas || 1,
        maxReplicas: config.maxReplicas || 5,
        metrics: [{
          type: 'Resource',
          resource: {
            name: 'cpu',
            target: {
              type: 'Utilization',
              averageUtilization: 80
            }
          }
        }]
      }
    };

    try {
      await autoscalingApi.createNamespacedHorizontalPodAutoscaler({ namespace, body: hpa });
    } catch (err) {
      if (err.statusCode === 409) {
        await autoscalingApi.replaceNamespacedHorizontalPodAutoscaler({
          name,
          namespace,
          body: hpa
        });
      } else {
        throw err;
      }
    }
    return { status: 'auto-scaling enabled', min: config.minReplicas, max: config.maxReplicas };
  } else {
    // Manual scaling - Delete HPA if it exists to prevent conflict, then scale deployment
    try {
      await autoscalingApi.deleteNamespacedHorizontalPodAutoscaler({ name, namespace });
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    const patch = { spec: { replicas: config.replicas } };
    await appsApi.patchNamespacedDeployment({
      name,
      namespace,
      body: patch
    }, undefined, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } });

    return { status: 'manual-scaling applied', replicas: config.replicas };
  }
}

async function restart(externalRef, opts) {
  const [namespace, name] = externalRef.split('/');
  const kc = getKubeConfig();
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);
  
  // To restart a deployment, we patch it with a new annotation
  const patch = {
    spec: {
      template: {
        metadata: {
          annotations: {
            "murzaktech.com/restartedAt": new Date().toISOString()
          }
        }
      }
    }
  };
  
  await appsApi.patchNamespacedDeployment({
    name,
    namespace,
    body: patch
  }, undefined, undefined, undefined, undefined, { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } });
  
  return { success: true };
}

async function attachDomain(externalRef, domain, opts) {
  const [namespace, name] = externalRef.split('/');
  const kc = getKubeConfig();
  const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

  const ingress = {
    metadata: { 
      name,
      annotations: {
        "cert-manager.io/cluster-issuer": "letsencrypt-prod" // Assuming cert-manager is used
      }
    },
    spec: {
      ingressClassName: "nginx", // Assuming NGINX ingress
      tls: [{
        hosts: [domain],
        secretName: `${name}-tls`
      }],
      rules: [{
        host: domain,
        http: {
          paths: [{
            path: "/",
            pathType: "Prefix",
            backend: {
              service: {
                name: name,
                port: { number: 80 }
              }
            }
          }]
        }
      }]
    }
  };

  try {
    await networkingApi.createNamespacedIngress({ namespace, body: ingress });
  } catch (err) {
    if (err.statusCode === 409) {
      await networkingApi.replaceNamespacedIngress({ name, namespace, body: ingress });
    } else {
      throw err;
    }
  }

  return { success: true, domain };
}

async function getUsage(externalRef, opts) {
  // In a real scenario, we would use the Kubernetes Metrics API (metrics.k8s.io)
  // For now, since the cluster isn't there, we'll return mock data or null.
  return {
    cpuPercent: null,
    ramUsedMb: null,
    ramLimitMb: null,
    diskUsedGb: null,
    diskLimitGb: null,
  };
}

module.exports = {
  lane: "k8s",
  isConfigured,
  configError,
  provision,
  scaleOut,
  restart,
  attachDomain,
  getUsage,
  resourceName,
  getContainerImage,
};
