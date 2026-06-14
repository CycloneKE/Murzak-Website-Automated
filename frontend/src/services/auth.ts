
import { User, AccountStatus, ProjectUpdate } from '../types';

const STORAGE_KEY = 'murzak_client_db';
const SESSION_KEY = 'murzak_active_session';

interface UserWithPassword extends User {
  password?: string;
}

const INITIAL_UPDATES: ProjectUpdate[] = [
  {
    id: 'upd-001',
    timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
    engineer: 'Samuel Okoth',
    content: 'Regional Node 02 (Nairobi) successfully provisioned. Initiating secure source handshake.',
    type: 'milestone',
    acknowledged: true
  },
  {
    id: 'upd-002',
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    engineer: 'Murzak Ops',
    content: 'Security hardening complete. SSH keys rotated and firewall rules applied to VPC.',
    type: 'technical',
    acknowledged: false
  },
  {
    id: 'upd-003',
    timestamp: new Date().toISOString(),
    engineer: 'Samuel Okoth',
    content: 'Awaiting your approval on the UI/UX blueprint for the Logistics Dashboard. View staging link in projects.',
    type: 'alert',
    acknowledged: false
  }
];

const INITIAL_USERS: UserWithPassword[] = [
  {
    id: 'admin-001',
    name: 'Musa Kamau',
    email: 'musa@murzaktech.com',
    password: 'password123',
    company: 'Murzak Engineering Group',
    plan: 'Enterprise',
    accountStatus: 'Active',
    projects: [
      { id: 'p1', name: 'Nairobi Smart Grid', status: 'Live', progress: 100 },
      { id: 'p2', name: 'Regional CRM Sync', status: 'In Development', progress: 65 }
    ],
    servers: [
      { id: 's1', name: 'Core Cluster A', ip: '197.232.1.1', status: 'Online', cpu: 15, ram: 30 }
    ],
    invoices: [
      { id: 'INV-2024-001', amount: 45000, date: '2024-04-01', status: 'Paid', type: 'Subscription' }
    ],
    updates: INITIAL_UPDATES,
  }
];

export const authService = {
  init: () => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_USERS));
    }
  },

  getUsers: (): UserWithPassword[] => {
    authService.init();
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  },

  login: (email: string, pass: string): User | null => {
    const users = authService.getUsers();
    const user = users.find(u => u.email === email && u.password === pass);
    if (user) {
      const sessionUser: UserWithPassword = { ...user };
      delete sessionUser.password;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
      return sessionUser as User;
    }
    return null;
  },

  signup: (userData: Partial<UserWithPassword>): User | null => {
    const users = authService.getUsers();
    if (users.find(u => u.email === userData.email)) return null;

    let initialStatus: AccountStatus = 'Pending';
    if (userData.plan === 'Test') {
      initialStatus = 'Provisioning';
    }

    const newUser: UserWithPassword = {
      id: `client-${Math.random().toString(36).substr(2, 9)}`,
      name: userData.name || 'New Client',
      email: userData.email || '',
      password: userData.password || 'murzak2024',
      company: userData.company || 'Private Entity',
      plan: userData.plan || 'None',
      accountStatus: initialStatus,
      sourceCode: userData.sourceCode,
      evaluationGoal: userData.evaluationGoal,
      projects: userData.sourceCode ? [{
        id: 'eval-p1',
        name: 'Evaluation Instance',
        status: 'Provisioning',
        progress: 10,
        sourceCode: userData.sourceCode
      }] : [],
      servers: [],
      invoices: [],
      updates: [
        {
          id: 'welcome-01',
          timestamp: new Date().toISOString(),
          engineer: 'System',
          content: 'Account verified. Nairobi cluster allocation initiated. Welcome to the Murzak network.',
          type: 'milestone',
          acknowledged: false
        }
      ]
    };

    users.push(newUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
    
    const sessionUser: UserWithPassword = { ...newUser };
    delete sessionUser.password;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
    return sessionUser as User;
  },

  getSession: (): User | null => {
    const session = sessionStorage.getItem(SESSION_KEY);
    return session ? JSON.parse(session) : null;
  },

  logout: () => {
    sessionStorage.removeItem(SESSION_KEY);
  }
};
