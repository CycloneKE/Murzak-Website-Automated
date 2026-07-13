export const setupApiInterceptor = () => {
  const originalFetch = window.fetch;

  window.fetch = async (...args) => {
    try {
      const response = await originalFetch(...args);
      
      // Intercept 502 Bad Gateway and 503 Service Unavailable
      if (response.status === 502 || response.status === 503) {
        window.dispatchEvent(new CustomEvent('api-gateway-error', { 
          detail: { status: response.status } 
        }));
      }

      return response;
    } catch (error) {
      // If the fetch completely fails (e.g., network error, DNS resolution fails)
      // we can also treat it as a backend down error if we want. 
      // For now, we only catch explicit 502/503 responses.
      throw error;
    }
  };
};
