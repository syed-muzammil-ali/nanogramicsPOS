// Invoice-linked return and exchange workflow.
const adjustmentEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class InvoiceAdjustmentManager {
 constructor(mode) { this.mode=mode; this.busy=false; }
 async init() {
  if(this.initialized) return; this.initialized=true;
  this.root=document.getElementById('tab-'+(this.mode==='return'?'returns':'exchange'));
  this.root.innerHTML='<h3>'+(this.mode==='return'?'Return an item':'Exchange an item')+'</h3><p>1. Find invoice → 2. Select products and quantities → 3. Review and print</p><form class="adjust-search"><input class="control-input" required aria-label="Invoice number" placeholder="Enter exact invoice number"><button class="btn-primary">Find invoice</button></form><div class="adjust-form"></div><div class="adjust-result"></div><h4>Saved invoices (latest 100)</h4><button type="button" class="adjust-refresh btn-secondary">Refresh history</button><div class="adjust-history"></div>';
  this.root.querySelector('form').onsubmit=e=>{e.preventDefault();this.search();};
  this.root.querySelector('.adjust-refresh').onclick=()=>this.loadHistory();
  await this.loadHistory();
 }
 async loadHistory() {
  try {
   const records=await (this.mode==='return'?API.getReturnsList():API.getExchangesList());
   const el=this.root.querySelector('.adjust-history');el.innerHTML='';
   if(!records.length){el.textContent='No saved invoices yet.';return;}
   records.forEach(row=>{const r=row.receipt;if(!r)return;const line=document.createElement('div');line.style.padding='10px';line.textContent=r.invoiceNumber+' | Original: '+r.originalInvoiceId+' | '+new Date(r.created_at).toLocaleString()+' | Refund: Rs '+formatCurrency(r.refundAmount)+' | Additional payment: Rs '+formatCurrency(r.additionalAmount)+' ';const b=document.createElement('button');b.className='btn-secondary';b.textContent='Reprint';b.onclick=()=>this.print(r);line.append(b);el.append(line);});
  }catch(e){showToast('Could not load saved invoices: '+e.message,'warning');}
 }
 async search() {
  if(this.busy) return;
  const requestId = this.searchId = (this.searchId || 0) + 1;
  this.invoice=null;this.root.querySelector('.adjust-form').innerHTML='';
  try {
   const result=await API.getInvoiceForReturn(this.root.querySelector('input').value.trim());
   if(requestId !== this.searchId)return;
   if(!result.success) throw Error(result.message || 'Invoice not found');
   const products=this.mode==='exchange'?await API.getProducts():[];
   if(requestId !== this.searchId)return;
   this.invoice=result.data;this.products=products;this.render();
  } catch(e) {showToast(e.message,'error');}
 }
 render() {
  const esc=adjustmentEscape, i=this.invoice;
  this.root.querySelector('.adjust-form').innerHTML='<h4>Invoice '+esc(i.id)+'</h4><p>Purchased: '+i.items.reduce((s,x)=>s+x.qty,0)+' items · Remaining product value: Rs '+formatCurrency(i.remainingAmount)+'</p><p>Select quantities to '+this.mode+'. Invoice discount is included; delivery and tax remain on the original invoice.</p><div class="adjust-table-scroll"><table style="width:100%"><thead><tr><th>Select</th><th>Product</th><th>Bought</th><th>Available</th><th>Net unit value</th><th>Quantity</th></tr></thead><tbody>'+i.items.map(x=>'<tr><td><input class="adjust-select" type="checkbox" data-index="'+x.itemIndex+'" aria-label="Select '+esc(x.name)+'" '+(!x.available?'disabled':'')+'></td><td>'+esc(x.name)+' ('+esc(x.code)+')</td><td>'+x.qty+'</td><td>'+x.available+'</td><td>Rs '+formatCurrency(x.refundPrice)+'</td><td><input class="adjust-qty control-input" data-index="'+x.itemIndex+'" type="number" min="0" max="'+x.available+'" step="1" value="0" '+(!x.available?'disabled':'')+'></td></tr>').join('')+'</tbody></table></div>'+(this.mode==='exchange'?'<h4>Select replacement products</h4><input class="replacement-search control-input" placeholder="Search replacement products"><div class="replacement-list">'+this.products.map((p,k)=>'<label style="display:block;padding:8px" data-name="'+esc((p.name+' '+p.code).toLowerCase())+'">'+esc(p.name)+' — '+esc(p.code)+' · Rs '+formatCurrency(p.price)+' · Stock '+p.qty+' <input class="replacement-qty control-input" data-index="'+k+'" type="number" min="0" step="1" value="0"></label>').join('')+'</div>':'')+'<p><input class="adjust-reason control-input" aria-label="Reason (optional)" placeholder="Reason (optional)"></p><div class="adjust-summary" aria-live="polite"></div><button class="adjust-submit btn-primary">Save & print '+this.mode+' invoice</button>';
  this.root.querySelectorAll('.adjust-select').forEach(el=>el.onchange=()=>{
   const qty=this.root.querySelector('.adjust-qty[data-index="'+el.dataset.index+'"]');
   qty.value=el.checked ? (Number(qty.value)>0 ? qty.value : '1') : '0';
   this.summary();
  });
  this.root.querySelectorAll('.adjust-qty,.replacement-qty').forEach(el=>el.oninput=()=>{
   if(el.classList.contains('adjust-qty')) {
    const checkbox=this.root.querySelector('.adjust-select[data-index="'+el.dataset.index+'"]');
    checkbox.checked=Number(el.value)>0;
   }
   this.summary();
  });
  const search=this.root.querySelector('.replacement-search'); if(search) search.oninput=()=>this.root.querySelectorAll('[data-name]').forEach(el=>el.hidden=!el.dataset.name.includes(search.value.toLowerCase()));
  this.root.querySelector('.adjust-submit').onclick=()=>this.submit(); this.summary();
 }
 selection(selector) {return [...this.root.querySelectorAll(selector)].filter(el=>Number(el.value)!==0).map(el=>({itemIndex:Number(el.dataset.index),qty:Number(el.value)}));}
 summary() {
  const credit=this.selection('.adjust-qty').reduce((s,x)=>s+x.qty*this.invoice.items[x.itemIndex].refundPrice,0);
  const amount=this.selection('.replacement-qty').reduce((s,x)=>s+x.qty*Number(this.products[x.itemIndex].price),0);
  const values=[['Selected value',credit],['Remaining product value',this.invoice.remainingAmount-credit],['Replacement total',amount],[amount>credit?'Amount to pay':'Amount to refund',Math.abs(amount-credit)]];
  this.root.querySelector('.adjust-summary').innerHTML=values.map(([label,value])=>'<div><span>'+label+'</span><strong>Rs '+formatCurrency(value)+'</strong></div>').join('');
 }
 async submit() {
  if(this.busy) return;
  if(!this.invoice) {showToast('Find an invoice first.','warning');return;}
  const items=this.selection('.adjust-qty');
  if(!items.length) {showToast('Select at least one product and enter the quantity to '+this.mode+'.','warning');return;}
  if(items.some(i=>!Number.isInteger(i.qty)||i.qty<1||i.qty>this.invoice.items[i.itemIndex]?.available)) {
   showToast('Enter a whole quantity between 1 and the available quantity for each selected product.','warning');return;
  }
  const replacements=this.selection('.replacement-qty');
  if(this.mode==='exchange' && (!replacements.length || replacements.some(i=>!Number.isInteger(i.qty)||i.qty<1))) {
   showToast('Select replacement products by entering a whole quantity of at least 1.','warning');return;
  }
  this.busy=true; const btn=this.root.querySelector('.adjust-submit');btn.disabled=true;
  try {
   const payload={invoiceId:this.invoice.id,invoiceType:this.invoice.invoiceType,items,newItems:replacements.map(x=>({code:this.products[x.itemIndex].code,qty:x.qty})),reason:this.root.querySelector('.adjust-reason').value};
   const result=await (this.mode==='return'?API.processReturn(payload):API.processExchange(payload));
   if(!result.success) throw Error(result.message || 'Unable to save');
   this.lastReceipt=result;this.invoice=null;this.root.querySelector('.adjust-form').innerHTML='';
   const out=this.root.querySelector('.adjust-result');out.innerHTML='<p>Saved '+adjustmentEscape(result.invoiceNumber)+'</p><button class="btn-secondary">Reprint invoice</button>';out.querySelector('button').onclick=()=>this.print(result);
   showToast('Invoice saved: '+result.invoiceNumber,'success'); await this.print(result); await this.loadHistory();
   if(typeof reports!=='undefined') await reports.refreshCurrentReport();
  } catch(e) {showToast(e.message,'error');} finally {this.busy=false;btn.disabled=false;}
 }
 async print(r) {
  const esc=adjustmentEscape, rows=(list)=>list.map(i=>'<div class="item"><div class="item-name">'+esc(i.name)+'</div><div>'+i.qty+' × Rs '+formatCurrency(i.refundPrice ?? i.price)+'</div></div>').join('');
  const html=buildThermalReceipt({receiptTitle:r.mode==='return'?'Return Invoice':'Exchange Invoice',id:r.invoiceNumber,date:new Date(r.created_at).toLocaleDateString(),time:new Date(r.created_at).toLocaleTimeString(),cashier:esc(auth.getCurrentUser()?.username || ''),itemsHtml:'<h3>'+r.mode.toUpperCase()+' INVOICE</h3><h4>Products received</h4>'+rows(r.items)+(r.newItems.length?'<h4>Replacement products</h4>'+rows(r.newItems):''),subtotal:r.credit,total:r.additionalAmount || r.refundAmount,extraInfo:[{label:'Original invoice',value:esc(r.originalInvoiceId)},{label:'Remaining product value',value:r.remainingAmount==null?'Not recorded':formatCurrency(r.remainingAmount)},{label:'Replacement total',value:formatCurrency(r.newAmount)},{label:'Amount to pay',value:formatCurrency(r.additionalAmount)},{label:'Amount to refund',value:formatCurrency(r.refundAmount)}]});
  try {const p=await window.electronAPI.invoke('print:receipt-silent',html);if(!p?.success) throw Error(p?.errorType || 'Printer unavailable');}catch(e){showToast('Invoice saved. Print failed: '+e.message+'. Use Reprint invoice.','warning');}
 }
}
const returnsManager = new InvoiceAdjustmentManager('return'); window.returnsManager=returnsManager;window.returns=returnsManager;
