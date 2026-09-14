const parse = value => { try { return JSON.parse(value || '[]'); } catch { return []; } };
const money = n => Math.round(n * 100) / 100;
function receipt(row, mode) {
 const saved = parse(row.receipt_json);
 if (saved && !Array.isArray(saved)) return {...saved, username:row.username || ''};
 const items = parse(mode === 'return' ? row.items_json : row.original_items);
 return { mode, invoiceNumber:mode === 'return' ? 'RET-'+String(row.id).padStart(6,'0') : row.exchange_number,
  originalInvoiceId:mode === 'return' ? row.invoice_id : row.original_invoice_id,
  invoiceType:row.invoice_type, items, newItems:mode === 'exchange' ? parse(row.new_items) : [],
  credit:Number(mode === 'return' ? row.refund_amount : row.original_amount), newAmount:Number(row.new_amount || 0),
  refundAmount:Number(row.refund_amount || 0), additionalAmount:Number(row.additional_amount || 0),
  remainingAmount:null, reason:row.return_reason || row.reason || '', username:row.username || '', created_at:row.created_at };
}
async function migrate(db) {
 for(const table of ['returns','exchanges']) {
  const columns=await db.queryRows(`PRAGMA table_info(${table})`);
  if(!columns.some(c=>c.name==='receipt_json')) await db.exec(`ALTER TABLE ${table} ADD COLUMN receipt_json TEXT`);
 }
}
async function report(db, startDate, endDate) {
 const rows=[];
 for(const [table,mode] of [['returns','return'],['exchanges','exchange']]) {
  const records=await db.queryRows(`SELECT * FROM ${table} WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC, id DESC`,[startDate,endDate]);
  rows.push(...records.map(r=>receipt(r,mode)));
 }
 rows.sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const sum=(list,key)=>money(list.reduce((s,r)=>s+Number(r[key] || 0),0));
 return {rows, summary:{returns:rows.filter(r=>r.mode==='return').length,exchanges:rows.filter(r=>r.mode==='exchange').length,
  refundAmount:sum(rows,'refundAmount'),additionalAmount:sum(rows,'additionalAmount'),netAdjustment:money(sum(rows,'additionalAmount')-sum(rows,'refundAmount'))}};
}
module.exports={receipt,migrate,report};
