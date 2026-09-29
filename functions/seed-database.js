/**
 * Database Seed Script for NUTrade Admin Web Panel
 * Database ID: "web-panel" in project "nutrade-a25c7"
 *
 * Populates initial schema documents and fields for web panel collections:
 *   - admin_security_codes
 *   - notifications
 *   - marketplace
 *   - products
 *   - items
 *   - posts
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Read access token from local firebase-tools configstore
function getAccessToken() {
    const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    if (!fs.existsSync(configPath)) {
        throw new Error(`Firebase tools config not found at: ${configPath}`);
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const token = config.tokens && config.tokens.access_token;
    if (!token) {
        throw new Error('No access_token found in firebase-tools config.');
    }
    return token;
}

const PROJECT_ID = 'nutrade-a25c7';
const DATABASE_ID = '(default)';

function toRestFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) {
            fields[k] = { nullValue: null };
        } else if (typeof v === 'boolean') {
            fields[k] = { booleanValue: v };
        } else if (typeof v === 'number') {
            if (Number.isInteger(v)) {
                fields[k] = { integerValue: String(v) };
            } else {
                fields[k] = { doubleValue: v };
            }
        } else if (typeof v === 'string') {
            fields[k] = { stringValue: v };
        } else if (typeof v === 'object') {
            fields[k] = { mapValue: { fields: toRestFields(v) } };
        }
    }
    return fields;
}

async function writeDoc(collection, docId, data) {
    const token = getAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${collection}/${docId}`;
    
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: toRestFields(data)
        })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`PATCH ${collection}/${docId} -> ${res.status} ${text}`);
    }
    const json = await res.json();
    return json;
}

async function seedWebPanelDatabase() {
    console.log(`Starting database seeding for Firestore database: '${DATABASE_ID}'...`);
    const now = new Date().toISOString();

    // 1. Seed admin_security_codes collection schema template
    await writeDoc('admin_security_codes', 'schema_template', {
        uid: 'schema_template',
        codeHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        expiresAt: new Date(Date.now() + 180000).toISOString(),
        updatedAt: now,
        _description: 'Template document defining schema for 2FA security codes'
    });
    console.log("✓ Initialized 'admin_security_codes' collection fields and schema");

    // 2. Seed notifications collection schema document
    await writeDoc('notifications', 'welcome_notice', {
        userId: 'system_admin',
        title: 'Welcome to NUTrade Web Admin Panel',
        message: 'Web admin panel database has been initialized successfully.',
        type: 'system_notice',
        read: false,
        createdAt: now
    });
    console.log("✓ Initialized 'notifications' collection fields and schema");

    // 3. Seed marketplace collection schema document
    await writeDoc('marketplace', 'init_marketplace', {
        title: 'NU Student Marketplace',
        description: 'Official National University student marketplace feed',
        category: 'General',
        status: 'active',
        createdAt: now,
        updatedAt: now
    });
    console.log("✓ Initialized 'marketplace' collection fields and schema");

    // 4. Seed products collection schema document
    await writeDoc('products', 'init_product', {
        name: 'NU Campus Merchandise Item',
        description: 'Official campus souvenir merchandise product',
        category: 'Merchandise',
        price: 250.00,
        status: 'available',
        createdAt: now
    });
    console.log("✓ Initialized 'products' collection fields and schema");

    // 5. Seed items collection schema document
    await writeDoc('items', 'init_item', {
        itemName: 'Pre-loved Textbook / Course Material',
        category: 'Textbooks',
        condition: 'used_good',
        status: 'active',
        createdAt: now
    });
    console.log("✓ Initialized 'items' collection fields and schema");

    // 6. Seed posts collection schema document
    await writeDoc('posts', 'init_post', {
        title: 'System Announcement: Web Panel Active',
        content: 'The NUTrade Admin Web Panel database configuration and security rules are active.',
        authorId: 'admin',
        status: 'published',
        createdAt: now
    });
    console.log("✓ Initialized 'posts' collection fields and schema");

    console.log(`\n🎉 Database seeding completed successfully for '${DATABASE_ID}'!`);
}

seedWebPanelDatabase().catch(err => {
    console.error("Seeding error:", err);
    process.exit(1);
});
