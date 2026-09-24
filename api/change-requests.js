const { supabase } = require('./_supabase');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const rows = await supabase('order_change_requests?select=*&order=created_at.desc&limit=50');
      return res.status(200).json({ requests: rows || [] });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    const input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!input?.order_number || !input?.customer_message || !input?.request_type) {
      return res.status(400).json({ error: 'Order number, request type and customer message are required.' });
    }
    const [created] = await supabase('order_change_requests', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ ...input, source: input.source || 'manual', status: input.status || 'needs_review' }])
    });
    await supabase('order_change_history', {
      method: 'POST',
      body: JSON.stringify([{ request_id: created.id, action: 'received', actor: input.source || 'manual', notes: 'Change request saved for review.', snapshot: input }])
    });
    return res.status(201).json({ request: created });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not save the change request.' });
  }
};
