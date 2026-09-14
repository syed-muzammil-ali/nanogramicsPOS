async function migrateShop(db) {
  // The existing v1 migration validates its tables exactly on every startup.
  // Keep category snapshots in an extension without changing that schema.
  await db.exec(`CREATE TABLE IF NOT EXISTS shop_issue_item_details (
    transfer_item_id INTEGER PRIMARY KEY REFERENCES stock_transfer_items(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT ''
  )`);
  // Views expose direction and shop balances without copying product/warehouse stock.
  await db.exec(`CREATE VIEW IF NOT EXISTS stock_movement_history AS
    SELECT t.*, source.name AS source_name, destination.name AS destination_name,
      source.kind AS source_kind, destination.kind AS destination_kind,
      CASE WHEN source.kind='warehouse' AND destination.kind='shop' THEN 'warehouse_to_shop'
           WHEN source.kind='shop' AND destination.kind='warehouse' THEN 'shop_to_warehouse'
           ELSE 'unsupported' END AS movement_type
    FROM stock_transfers t JOIN stock_locations source ON source.id=t.source_location_id
    JOIN stock_locations destination ON destination.id=t.destination_location_id`);
  await db.exec(`CREATE VIEW IF NOT EXISTS shop_stock_balances AS
    SELECT location_id, product_id, SUM(quantity) AS quantity FROM (
      SELECT t.destination_location_id AS location_id, i.product_id, i.quantity
      FROM stock_transfers t JOIN stock_transfer_items i ON i.transfer_id=t.id
      JOIN stock_locations l ON l.id=t.destination_location_id
      WHERE t.status='posted' AND l.kind='shop' AND i.product_id IS NOT NULL
      UNION ALL
      SELECT t.source_location_id AS location_id, i.product_id, -i.quantity
      FROM stock_transfers t JOIN stock_transfer_items i ON i.transfer_id=t.id
      JOIN stock_locations l ON l.id=t.source_location_id
      WHERE t.status='posted' AND l.kind='shop' AND i.product_id IS NOT NULL
    ) GROUP BY location_id, product_id`);
}

class ShopService {
  constructor(db) { this.db = db; }

  async issue(data, user) {
    // Existing IPC remains an outbound-only adapter. Client fields cannot reverse it.
    return this.transfer({ ...data, movementType: 'warehouse_to_shop', sourceLocationId: undefined, destinationLocationId: undefined }, user);
  }

  // Internal service API; no return/adjustment IPC or UI is exposed yet.
  async transfer(data, user) {
    const movementType = data?.movementType;
    if (!['warehouse_to_shop', 'shop_to_warehouse'].includes(movementType)) throw new Error('Unsupported movement type.');
    const outbound = movementType === 'warehouse_to_shop';
    const explicitLocations = data.sourceLocationId != null || data.destinationLocationId != null;
    if (explicitLocations && (!Number.isSafeInteger(data.sourceLocationId) || !Number.isSafeInteger(data.destinationLocationId) || data.sourceLocationId <= 0 || data.destinationLocationId <= 0 || data.sourceLocationId === data.destinationLocationId)) throw new Error('Select distinct valid source and destination locations.');
    if (!outbound && !explicitLocations) throw new Error('Shop returns require explicit source and destination locations.');
    const person = String(data?.person || '').trim();
    const location = String(data?.location || '').trim();
    const requestId = String(data?.requestId || '');
    if (!person || person.length > 150) throw new Error('Enter a Person Name (up to 150 characters).');
    if ((!location && !explicitLocations) || location.length > 150) throw new Error('Enter a Shop/Location (up to 150 characters).');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Invalid issue reference. Start a new shop issue.');
    if (!data.transferredAt || !Number.isFinite(Date.parse(data.transferredAt))) throw new Error('Enter a valid date and time.');
    const transferredAt = new Date(data.transferredAt).toISOString();
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 500) throw new Error('Select between 1 and 500 products.');
    const codes = new Set();
    for (const item of data.items) {
      if (typeof item.code !== 'string' || !item.code || codes.has(item.code)) throw new Error('Select each existing product only once.');
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('Issue Quantity must be a positive whole number.');
      codes.add(item.code);
    }
    const totalQuantity = data.items.reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isSafeInteger(totalQuantity)) throw new Error('Total quantity is too large.');
    const number = `SHOP-${requestId}`;
    return this.db.runTransaction(async tx => {
      const [existing] = await tx.queryRows('SELECT t.*, t.destination_name AS location FROM stock_movement_history t WHERE transfer_number = ?', [number]);
      if (existing) {
        const stored = await tx.queryRows('SELECT product_code, quantity FROM stock_transfer_items WHERE transfer_id = ?', [existing.id]);
        const sameRoute = existing.movement_type === movementType && (explicitLocations ? existing.source_location_id === data.sourceLocationId && existing.destination_location_id === data.destinationLocationId : existing.location.toLowerCase() === location.toLowerCase());
        const matches = sameRoute && existing.status === 'posted' && existing.created_by_user_id === user.id && existing.person_name === person && existing.transferred_at === transferredAt && stored.length === data.items.length && stored.every(s => data.items.some(i => i.code === s.product_code && i.quantity === s.quantity));
        if (!matches) throw new Error('This issue reference was already used for different details. Start a new issue.');
        return { success: true, transferNumber: number, totalProducts: stored.length, totalQuantity, alreadySaved: true };
      }
      const [warehouse] = await tx.queryRows("SELECT * FROM stock_locations WHERE kind = 'warehouse' AND status = 'active'");
      if (!warehouse) throw new Error('An active warehouse location is required.');
      let source = warehouse, destination;
      if (explicitLocations) {
        [source] = await tx.queryRows('SELECT * FROM stock_locations WHERE id=?', [data.sourceLocationId]);
        [destination] = await tx.queryRows('SELECT * FROM stock_locations WHERE id=?', [data.destinationLocationId]);
        if (!source || !destination || source.status !== 'active' || destination.status !== 'active' || source.kind !== (outbound ? 'warehouse' : 'shop') || destination.kind !== (outbound ? 'shop' : 'warehouse')) throw new Error('Location direction does not match movement type, or a location is inactive.');
      }
      const products = [];
      for (const item of data.items) {
        const [product] = await tx.queryRows('SELECT * FROM products WHERE code = ?', [item.code]);
        if (!product) throw new Error(`Product ${item.code} no longer exists. Refresh inventory.`);
        const [balance] = outbound ? [] : await tx.queryRows('SELECT quantity FROM shop_stock_balances WHERE location_id=? AND product_id=?', [source.id, product.id]);
        const available = outbound ? Number(product.qty) : Number(balance?.quantity || 0);
        if (!Number.isFinite(available) || available < item.quantity) {
          throw new Error(`Insufficient Stock. Available: ${Number.isFinite(available) ? available : 0}, Requested: ${item.quantity}. (${product.name})`);
        }
        products.push({ ...product, quantity: item.quantity });
      }
      const now = new Date().toISOString();
      let shop = outbound ? destination : source;
      if (!shop) [shop] = await tx.queryRows('SELECT * FROM stock_locations WHERE name = ? COLLATE NOCASE', [location]);
      if (shop && (shop.kind !== 'shop' || shop.status !== 'active')) throw new Error('Select an active shop destination, different from the warehouse.');
      if (!shop) {
        const saved = await tx.exec("INSERT INTO stock_locations(name,kind,status,created_at) VALUES(?, 'shop', 'active', ?)", [location, now]);
        shop = { id: saved.lastID };
      }
      destination = destination || shop;
      const transfer = await tx.exec(`INSERT INTO stock_transfers(transfer_number,person_name,source_location_id,destination_location_id,transferred_at,status,created_by_user_id,created_by_username,created_at,posted_at)
        VALUES(?,?,?,?,?,'posted',?,?,?,?)`, [number, person, source.id, destination.id, transferredAt, user.id, user.username, now, now]);
      for (const product of products) {
        const updated = outbound
          ? await tx.exec('UPDATE products SET qty = qty - ?, updated_at = ? WHERE id = ? AND qty >= ?', [product.quantity, now, product.id, product.quantity])
          : await tx.exec('UPDATE products SET qty = qty + ?, updated_at = ? WHERE id = ? AND qty >= 0 AND qty <= ?', [product.quantity, now, product.id, Number.MAX_SAFE_INTEGER - product.quantity]);
        if (updated.changes !== 1) throw new Error(`Stock changed for ${product.name}. Refresh and retry.`);
        const item = await tx.exec(`INSERT INTO stock_transfer_items(transfer_id,product_id,product_code,product_name,brand,quantity,reference_price) VALUES(?,?,?,?,?,?,?)`,
          [transfer.lastID, product.id, product.code, product.name, product.brand || '', product.quantity, Math.max(0, Number(product.price) || 0)]);
        await tx.exec('INSERT INTO shop_issue_item_details(transfer_item_id,category) VALUES(?,?)', [item.lastID, product.category || '']);
      }
      await tx.exec(`INSERT INTO audit_log(timestamp,user_id,username,user_role,system_type,action,details,created_at)
        VALUES(?,?,?,?,?,?,?,?)`, [now, user.id, user.username, user.role || 'cashier', 'Offline', outbound ? 'Shop Stock Issue Completed' : 'Shop Stock Return Completed', JSON.stringify({ transferId: transfer.lastID, transferNumber: number, sourceLocationId: source.id, destinationLocationId: destination.id, movementType, status: 'posted', person, shop: shop.name || location, transferredAt, totalProducts: products.length, totalQuantity, items: products.map(p => ({ code: p.code, name: p.name, brand: p.brand, quantity: p.quantity })) }), now]);
      return { success: true, transferNumber: number, totalProducts: products.length, totalQuantity };
    });
  }

  list(page = 0) {
    if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) throw new Error('Invalid history page.');
    return this.db.queryRows(`SELECT t.*, l.name AS shop_name, COUNT(i.id) AS total_products, SUM(i.quantity) AS total_quantity
      FROM stock_transfers t JOIN stock_locations l ON l.id=t.destination_location_id
      JOIN stock_locations source ON source.id=t.source_location_id
      JOIN stock_transfer_items i ON i.transfer_id=t.id
      WHERE t.status='posted' AND source.kind='warehouse' AND l.kind='shop'
      GROUP BY t.id ORDER BY t.created_at DESC, t.id DESC LIMIT 100 OFFSET ?`, [page * 100]);
  }

  async details(id) {
    const [record] = await this.db.queryRows(`SELECT t.*, l.name AS shop_name, source.name AS source_name FROM stock_transfers t JOIN stock_locations l ON l.id=t.destination_location_id JOIN stock_locations source ON source.id=t.source_location_id WHERE t.id=? AND source.kind='warehouse' AND l.kind='shop' AND t.status='posted'`, [id]);
    if (!record) throw new Error('Shop issue not found.');
    const items = await this.db.queryRows("SELECT i.*, COALESCE(d.category, '') AS category FROM stock_transfer_items i LEFT JOIN shop_issue_item_details d ON d.transfer_item_id=i.id WHERE i.transfer_id=? ORDER BY i.id", [id]);
    return { ...record, items };
  }
}

module.exports = { ShopService, migrateShop };
