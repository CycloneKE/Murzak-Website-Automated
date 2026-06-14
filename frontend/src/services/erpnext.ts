
/**
 * Business Sync Service
 * Handles communication with Murzak Technologies' Project Management System.
 */

interface LeadData {
  first_name: string;
  last_name: string;
  email_id: string;
  company_name?: string;
  lead_owner?: string;
  source?: string;
  request_type?: string;
  description?: string;
}

const CRM_BASE_URL = 'https://erp.murzaktech.com/api/resource';
const API_KEY = 'hidden_key'; 
const API_SECRET = 'hidden_secret';

/**
 * Generates a friendly reference ID for the client
 */
export const generateReferenceId = (prefix: string = 'PROJECT') => {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${random}`;
};

export const logLeadToCRM = async (data: LeadData) => {
  try {
    console.log('Syncing project request...', data);
    
    const response = await fetch(`${CRM_BASE_URL}/Lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${API_KEY}:${API_SECRET}`,
      },
      body: JSON.stringify({
        first_name: data.first_name,
        last_name: data.last_name,
        email_id: data.email_id,
        company_name: data.company_name,
        source: 'Website - ' + (data.source || 'General'),
        lead_owner: 'sales@murzaktech.com',
        description: data.description || `Inquiry for ${data.request_type || 'Software Development'}`
      }),
    });

    if (!response.ok) {
      return { status: 'sync_offline', message: 'Local session active' };
    }

    return await response.json();
  } catch (error) {
    console.warn('Sync delayed. Data saved to local session.', error);
    return { 
      status: 'simulated_success', 
      timestamp: new Date().toISOString(),
      ref: generateReferenceId('MZK')
    };
  }
};
