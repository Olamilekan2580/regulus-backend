import { useState, useEffect } from 'react';
import { Plus, Receipt, Calendar, DollarSign, Download } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import api from '../lib/api';

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  
  const [formData, setFormData] = useState({ 
    client_id: '', 
    invoice_number: `INV-${Math.floor(1000 + Math.random() * 9000)}`, 
    total: '', 
    status: 'Draft', 
    due_date: '' 
  });

  const fetchData = async () => {
    try {
      const [invRes, clientRes] = await Promise.all([
        api.get('/invoices'), 
        api.get('/clients')
      ]);
      setInvoices(invRes.data || []);
      setClients(clientRes.data || []);
      if (clientRes.data.length > 0) {
        setFormData(prev => ({ ...prev, client_id: clientRes.data[0].id }));
      }
    } catch (err) { 
      console.error(err); 
    } finally { 
      setLoading(false); 
    }
  };

  useEffect(() => { fetchData(); }, []);

  // FRONTEND DATA MAPPING: Bypasses the broken backend join
  const getClientDetails = (clientId) => {
    const foundClient = clients.find(c => c.id === clientId);
    if (!foundClient) return { name: 'Unknown Client', email: 'No email provided' };
    return {
      name: foundClient.company || foundClient.name || 'Unknown Client',
      email: foundClient.email || 'No email provided'
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/invoices', { ...formData, total: parseFloat(formData.total) });
      setIsModalOpen(false);
      fetchData();
    } catch (err) { 
      console.error('Failed to create invoice'); 
    }
  };

  const updateStatus = async (id, newStatus) => {
    setInvoices(invoices.map(inv => inv.id === id ? { ...inv, status: newStatus } : inv));
    try {
      await api.put(`/updates/invoices/${id}`, { status: newStatus });
    } catch (err) {
      console.error('Failed to update status');
      fetchData(); 
    }
  };

  const handleDownload = async (invoice) => {
    setDownloadingId(invoice.id);
    
    try {
      const clientData = getClientDetails(invoice.client_id);
      
      const dateOptions = { month: 'long', day: 'numeric', year: 'numeric' };
      const dateIssued = new Date(invoice.created_at || Date.now()).toLocaleDateString('en-US', dateOptions);
      const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-US', dateOptions) : 'Upon receipt';

      const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD'
      }).format(amount || 0);

      const watermark = invoice.status === 'Paid' 
        ? `<div style="position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 140px; font-weight: 900; color: rgba(34, 197, 94, 0.06); z-index: 0; pointer-events: none; letter-spacing: 10px;">PAID</div>` 
        : '';

      const htmlContent = `
        <div id="invoice-pdf-container" style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 60px; color: #0f172a; max-width: 800px; margin: 0 auto; background: white; position: relative; overflow: hidden; min-height: 1056px;">
          ${watermark}
          <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f8fafc; padding-bottom: 32px; position: relative; z-index: 1;">
            <div>
              <div style="font-size: 32px; font-weight: 900; color: #0f172a; letter-spacing: -0.02em;">Regulus.</div>
              <div style="font-size: 13px; color: #64748b; margin-top: 4px; font-weight: 500;">High-Performance Architecture</div>
            </div>
            <div style="text-align: right">
              <div style="font-size: 24px; font-weight: 800; letter-spacing: 0.05em; color: #e2e8f0; text-transform: uppercase;">Invoice</div>
              <div style="font-size: 16px; color: #0f172a; font-weight: 600; margin-top: 4px;">${invoice.invoice_number}</div>
            </div>
          </div>

          <div style="margin-top: 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; position: relative; z-index: 1;">
            <div>
              <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; letter-spacing: 0.05em; margin-bottom: 12px;">Billed To</div>
              <div style="font-weight: 700; font-size: 18px; color: #0f172a;">${clientData.name}</div>
              <div style="color: #64748b; font-size: 14px; margin-top: 4px;">${clientData.email}</div>
            </div>
            <div style="text-align: right">
              <div style="display: flex; justify-content: flex-end; gap: 32px;">
                <div>
                  <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; letter-spacing: 0.05em; margin-bottom: 8px;">Date Issued</div>
                  <div style="font-weight: 600; font-size: 14px; color: #1e293b;">${dateIssued}</div>
                </div>
                <div>
                  <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #94a3b8; letter-spacing: 0.05em; margin-bottom: 8px;">Due Date</div>
                  <div style="font-weight: 600; font-size: 14px; color: #1e293b;">${dueDate}</div>
                </div>
              </div>
            </div>
          </div>

          <table style="width: 100%; margin-top: 64px; border-collapse: collapse; position: relative; z-index: 1;">
            <thead>
              <tr>
                <th style="text-align: left; background: #f8fafc; padding: 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 8px 0 0 8px;">Description</th>
                <th style="text-align: right; background: #f8fafc; padding: 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 0 8px 8px 0;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 24px 16px; border-bottom: 1px solid #f1f5f9; font-size: 15px; color: #1e293b; font-weight: 500;">Professional Engineering & Automation Services</td>
                <td style="padding: 24px 16px; border-bottom: 1px solid #f1f5f9; font-size: 15px; color: #0f172a; font-weight: 600; text-align: right;">${formatCurrency(invoice.total)}</td>
              </tr>
            </tbody>
          </table>

          <div style="margin-top: 48px; display: flex; justify-content: flex-end; position: relative; z-index: 1;">
            <div style="background: ${invoice.status === 'Paid' ? '#f0fdf4' : '#f8fafc'}; border: 1px solid ${invoice.status === 'Paid' ? '#bbf7d0' : '#e2e8f0'}; padding: 32px; border-radius: 16px; min-width: 320px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <span style="font-size: 14px; font-weight: 600; color: #64748b;">Subtotal</span>
                <span style="font-size: 14px; font-weight: 600; color: #0f172a;">${formatCurrency(invoice.total)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 16px; border-top: 1px solid ${invoice.status === 'Paid' ? '#dcfce7' : '#e2e8f0'};">
                <span style="font-size: 12px; text-transform: uppercase; font-weight: 800; color: ${invoice.status === 'Paid' ? '#166534' : '#94a3b8'}; letter-spacing: 0.05em;">Total Due</span>
                <span style="font-size: 36px; font-weight: 900; color: ${invoice.status === 'Paid' ? '#16a34a' : '#0f172a'}; letter-spacing: -0.02em;">${formatCurrency(invoice.total)}</span>
              </div>
            </div>
          </div>
        </div>
      `;

      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '-9999px';
      container.innerHTML = htmlContent;
      document.body.appendChild(container);

      const opt = {
        margin:       0,
        filename:     `Invoice_${invoice.invoice_number}.pdf`,
        image:        { type: 'jpeg', quality: 1 },
        html2canvas:  { scale: 3, useCORS: true, letterRendering: true }, 
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(container.firstElementChild).save();
      document.body.removeChild(container);

    } catch (err) {
      console.error('PDF Generation Failed:', err);
      alert('CRITICAL FAILURE: html2pdf crashed locally.');
    } finally {
      setDownloadingId(null);
    }
  };

  const statusColors = {
    'Draft': 'bg-gray-100 text-gray-700 border-gray-200',
    'Sent': 'bg-blue-50 text-blue-700 border-blue-200',
    'Paid': 'bg-green-50 text-green-700 border-green-200',
    'Overdue': 'bg-red-50 text-red-700 border-red-200'
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-navy">Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">Manage billing and payments</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)} 
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-navy/90 transition-colors"
        >
          <Plus size={20} /> Create Invoice
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-gray-400">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy mr-3"></div>
          Loading invoices...
        </div>
      ) : invoices?.length === 0 ? (
        <div className="flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <Receipt size={32} className="text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-navy mb-2">No invoices yet</h3>
          <p className="text-gray-500 mb-6 max-w-md">Get paid faster. Create your first invoice and send it directly to your clients.</p>
          <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 bg-navy text-white px-6 py-2.5 rounded-lg font-medium shadow-sm hover:bg-navy/90 transition-colors">
            <Plus size={18} /> Create First Invoice
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {invoices.map(invoice => {
            const clientData = getClientDetails(invoice.client_id);
            return (
              <div key={invoice.id} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex flex-col h-full">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-navy">{invoice.invoice_number}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">{clientData.name}</p>
                  </div>
                  <select 
                    value={invoice.status}
                    onChange={(e) => updateStatus(invoice.id, e.target.value)}
                    className={`text-xs px-3 py-1.5 rounded-full font-bold border outline-none cursor-pointer appearance-none ${statusColors[invoice.status] || statusColors['Draft']}`}
                  >
                    <option value="Draft">Draft</option>
                    <option value="Sent">Sent</option>
                    <option value="Paid">Paid</option>
                    <option value="Overdue">Overdue</option>
                  </select>
                </div>
                
                <div className="flex items-center gap-2 mb-6">
                  <DollarSign size={20} className="text-gray-400" />
                  <span className="text-2xl font-bold text-navy">{invoice.total}</span>
                </div>
                
                <div className="flex items-center justify-between border-t border-gray-50 pt-4 mt-auto">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Calendar size={14} className="text-gray-400" />
                    Due: {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'Upon receipt'}
                  </div>
                  
                  <button
                    onClick={() => handleDownload(invoice)}
                    disabled={downloadingId === invoice.id}
                    className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {downloadingId === invoice.id ? (
                      <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Download size={14} />
                    )}
                    {downloadingId === invoice.id ? 'Generating...' : 'PDF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Premium Invoice Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-navy/40 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
            <h2 className="text-2xl font-bold text-navy mb-1">Create Invoice</h2>
            <p className="text-sm text-gray-500 mb-6">Generate a new billing request.</p>
            
            {clients.length === 0 ? (
              <div className="text-center p-8 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-gray-600 mb-4 font-medium">You need to add a Client before creating an Invoice.</p>
                <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 bg-navy text-white font-medium rounded-xl hover:bg-navy/90 transition-all">Close</button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Client *</label>
                  <select required className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl focus:bg-white focus:ring-2 focus:ring-navy/20 focus:border-navy outline-none transition-all text-sm font-medium appearance-none" value={formData.client_id} onChange={e => setFormData({...formData, client_id: e.target.value})}>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Amount ($) *</label>
                    <input type="number" step="0.01" required className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl focus:bg-white focus:ring-2 focus:ring-navy/20 focus:border-navy outline-none transition-all text-sm font-medium" value={formData.total} onChange={e => setFormData({...formData, total: e.target.value})} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Due Date *</label>
                    <input type="date" required className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl focus:bg-white focus:ring-2 focus:ring-navy/20 focus:border-navy outline-none transition-all text-sm font-medium text-gray-700" value={formData.due_date} onChange={e => setFormData({...formData, due_date: e.target.value})} />
                  </div>
                </div>
                
                <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-gray-50">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 font-medium text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
                  <button type="submit" className="px-5 py-2.5 font-medium text-sm bg-navy text-white rounded-xl hover:bg-navy/90 transition-all shadow-sm active:scale-95">Save Invoice</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}