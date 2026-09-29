const fs = require('fs');
const path = require('path');
const os = require('os');

function getAccessToken() {
    const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.tokens.access_token;
}

const PROJECT_ID = 'nutrade-a25c7';
const TARGET_UID = 'dCBnDoMfqlQKBgpM3ifXIeQSaJl1';

async function setAdminAccount() {
    const token = getAccessToken();
    console.log(`Updating Auth account and claims for UID: ${TARGET_UID}...`);

    // 1. Update Firebase Auth user: emailVerified = true, customAttributes = { role: "admin", admin: true }
    const updateUrl = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`;
    const updateRes = await fetch(updateUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            localId: TARGET_UID,
            emailVerified: true,
            customAttributes: JSON.stringify({
                role: 'admin',
                admin: true
            })
        })
    });

    if (!updateRes.ok) {
        const text = await updateRes.text();
        throw new Error(`Failed to update Auth account: ${updateRes.status} ${text}`);
    }

    const updateData = await updateRes.json();
    console.log('✓ Firebase Auth account updated successfully!');
    console.log('  Email:', updateData.email);
    console.log('  Email Verified:', updateData.emailVerified);
    console.log('  Custom Attributes:', updateData.customAttributes);

    // 2. Update Firestore profile /users/{uid} in (default) database
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${TARGET_UID}?updateMask.fieldPaths=role&updateMask.fieldPaths=verificationStatus&updateMask.fieldPaths=canPost&updateMask.fieldPaths=canBid&updateMask.fieldPaths=canChat&updateMask.fieldPaths=emailVerified`;
    const docRes = await fetch(firestoreUrl, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: {
                role: { stringValue: 'admin' },
                verificationStatus: { stringValue: 'verified' },
                canPost: { booleanValue: true },
                canBid: { booleanValue: true },
                canChat: { booleanValue: true },
                emailVerified: { booleanValue: true }
            }
        })
    });

    if (docRes.ok) {
        console.log('✓ Firestore profile document /users/' + TARGET_UID + ' updated in (default) database!');
    } else {
        const text = await docRes.text();
        console.warn(`Firestore profile update response ${docRes.status}: ${text}`);
    }

    console.log('\n🎉 Admin account setup complete for ' + updateData.email + ' (UID: ' + TARGET_UID + ')!');
}

setAdminAccount().catch(err => {
    console.error('Error setting admin account:', err);
    process.exit(1);
});
