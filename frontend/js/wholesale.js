class WholesaleManager {
 constructor() { this.cart=[]; this.busy=false; this.products=[]; }
 async init() {
  try {
   this.products=await API.getProducts();
   if(!this.initialized) {
    this.initialized=true;
    document.getElementById('wholesale-search').oninput=()=>this.renderProducts();
    ['wholesale-discount','wholesale-delivery'].forEach(id=>document.getElementById(id).oninput=()=>this.summary());
    document.getElementById('btn-wholesale-clear').onclick=()=>{if(!this.busy)this.clear();};
    const complete=document.getElementById('btn-wholesale-complete');
    complete.textContent='Complete & print'; complete.onclick=()=>this.save();
    this.retry=document.createElement('button'); this.retry.className='btn-secondary';
    this.retry.textContent='Reprint last invoice'; this.retry.disabled=true;
    this.retry.onclick=()=>this.lastSale && sales.printReceipt(this.lastSale); complete.after(this.retry);
   }
   this.render();
  }catch(e){showToast('Could not load wholesale products: '+e.message,'error');}
 }
 clear() {
  this.cart=[];
  ['wholesale-discount','wholesale-delivery'].forEach(id=>document.getElementById(id).value='0');
  this.render();
 }
 renderProducts() {
  const el=document.getElementById('wholesale-product-list');
  const term=document.getElementById('wholesale-search').value.toLowerCase().trim(); el.replaceChildren();
  const products=this.products.filter(p=>(p.name+' '+p.code).toLowerCase().includes(term));
  if(!products.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent='No matching products. Try another name or code.';el.append(empty);}
  products.forEach(p=>{
   const b=document.createElement('button'); b.type='button';b.className='product-card';
   for(const [className,value] of [['product-category',p.category||'General'],['product-card-name',p.name],['pos-product-meta',p.code],['product-card-price','Rs '+formatCurrency(p.price)],['pos-product-meta','Available: '+p.qty]]) {
    const text=document.createElement('span');text.className=className;text.textContent=value;b.append(text);
   }
   b.disabled=this.busy||Number(p.qty)<=0;
   b.onclick=()=>{
    if(this.busy)return;
    const item=this.cart.find(i=>i.code===p.code);
    if((item?.qty||0)>=Number(p.qty)){showToast('Insufficient stock','warning');return;}
    if(item)item.qty++;else this.cart.push({...p,price:Number(p.price),qty:1});this.render();
   };el.append(b);
  });
 }
 render() {
  this.renderProducts();const el=document.getElementById('wholesale-cart-items');el.replaceChildren();
  if(!this.cart.length){const empty=document.createElement('div');empty.className='cart-empty';empty.textContent='Select products to start a wholesale sale.';el.append(empty);}
  this.cart.forEach((item,index)=>{
   const row=document.createElement('div');row.className='cart-item';
   const title=document.createElement('div');title.textContent=item.name;row.append(title);
   for(const [key,label] of [['qty','Quantity'],['price','Unit price (Rs)']]) {
    const wrap=document.createElement('label');wrap.textContent=label;
    const input=document.createElement('input');input.className='control-input';input.type='number';
    input.min=key==='qty'?1:0;input.step=key==='qty'?1:0.01;input.value=item[key];input.disabled=this.busy;
    input.oninput=()=>{if(this.busy)return;item[key]=input.validity.badInput?NaN:Number(input.value);this.summary();};
    wrap.append(input);row.append(wrap);
   }
   const remove=document.createElement('button');remove.textContent='Remove item';remove.disabled=this.busy;
   remove.onclick=()=>{if(!this.busy){this.cart.splice(index,1);this.render();}};row.append(remove);el.append(row);
  }); this.summary();
 }
 summary() {
  this.subtotal=this.cart.reduce((sum,item)=>sum+item.price*item.qty,0);
  this.discount=Number(document.getElementById('wholesale-discount').value);
  this.delivery=Number(document.getElementById('wholesale-delivery').value);
  this.total=Math.round((this.subtotal-this.discount+this.delivery)*100)/100;
  for(const key of ['subtotal','total'])document.getElementById('wholesale-'+key).textContent=Number.isFinite(this[key])?'Rs '+formatCurrency(this[key]):'Check amounts';
 }
 async save() {
  if(this.busy)return;this.summary();
  if(!this.cart.length||this.cart.some(i=>!Number.isInteger(i.qty)||i.qty<1||!Number.isFinite(i.price)||i.price<0||i.qty>Number(this.products.find(p=>p.code===i.code)?.qty))||!Number.isFinite(this.total)||this.discount<0||this.discount>this.subtotal||this.delivery<0) {
   showToast('Check stock, quantities, prices and discount.','warning');return;
  }
  this.busy=true;this.render();
  const controls=[...document.querySelectorAll('#tab-wholesale .sale-buttons button, #tab-wholesale .sale-summary input, #wholesale-payment-method')];
  const disabled=controls.map(el=>el.disabled);controls.forEach(el=>el.disabled=true);
  try {
   const sale={id:'WH-'+crypto.randomUUID(),items:this.cart.map(i=>({...i})),subtotal:this.subtotal,discount:this.discount,delivery:this.delivery,total:this.total,tax:0,cashback:0,payment_method:document.getElementById('wholesale-payment-method').value,payment_status:'paid',notes:'WHOLESALE',cashier:auth.getCurrentUser()?.username};
   const saved=await API.createSale(sale);if(!saved?.success)throw Error(saved?.message||'Sale was not saved');
   this.lastSale=sale;this.clear();showToast('Wholesale invoice saved.','success');
   await sales.printReceipt(sale);
   try{this.products=await API.getProducts();}catch(e){showToast('Sale saved. Product refresh failed: '+e.message,'warning');}
  }catch(e){showToast(e.message,'error');}
  finally{this.busy=false;controls.forEach((el,i)=>el.disabled=disabled[i]);if(this.retry)this.retry.disabled=!this.lastSale;this.render();}
 }
}
const wholesale=new WholesaleManager();window.wholesale=wholesale;
