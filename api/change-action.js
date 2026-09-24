const { supabase } = require('./_supabase');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    const input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { id, action, reason = '' } = input || {};
    if (!id || !['approved', 'rejected', 'payment_due'].includes(action)) return res.status(400).json({ error: 'Invalid action.' });
    const patch = { status: action, updated_at: new Date().toISOString() };
    if (action === 'approved') { patch.approved_by = 'Team'; patch.approved_at = new Date().toISOString(); }
    if (action === 'rejected') patch.rejection_reason = reason || 'Rejected by team';
    const [updated] = await supabase(`order_change_requests?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    await supabase('order_change_history', { method: 'POST', body: JSON.stringify([{ request_id: id, action, actor: 'Team', notes: reason, snapshot: patch }]) });
    return res.status(200).json({ request: updated });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not update request status.' });
  }
};
