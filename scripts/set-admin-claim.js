/**
 * NUTrade - One-time script to grant admin custom claim to a Firebase user.
 * 
 * USAGE:
 *   1. Download your Firebase service account key from:
 *      Firebase Console > Project Settings > Service Accounts > Generate new private key
 *   2. Save the JSON file as: serviceAccountKey.json (in this scripts/ folder)
 *   3. Run:  node set-admin-claim.js <email>
 *      e.g.: node set-admin-claim.js jamesadreuu29@gmail.com
 */

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("path");

const EMAIL = process.argv[2];
if (!EMAIL) {
    console.error("Usage: node set-admin-claim.js <email>");
    process.exit(1);
}

const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");
let serviceAccount;
try {
    serviceAccount = require(serviceAccountPath);
} catch (e) {
    console.error("\n❌ serviceAccountKey.json not found.");
    console.error("Download it from: Firebase Console > Project Settings > Service Accounts > Generate new private key");
    console.error("Save it as: " + serviceAccountPath);
    process.exit(1);
}

initializeApp({
    credential: cert(serviceAccount),
    projectId: "nutrade-a25c7"
});

(async () => {
    try {
        const auth = getAuth();
        const db = getFirestore();

        const user = await auth.getUserByEmail(EMAIL);
        console.log(`\n✅ Found user: ${user.uid} (${user.email})`);

        // Set the admin custom claim
        await auth.setCustomUserClaims(user.uid, { role: "admin" });
        console.log(`✅ Custom claim set: { role: "admin" } on ${EMAIL}`);

        // Also set in Firestore users collection (for redundant admin check)
        await db.collection("users").doc(user.uid).set(
            { role: "admin", verificationStatus: "verified" },
            { merge: true }
        );
        console.log(`✅ Firestore users/${user.uid} updated with role: "admin"`);

        console.log("\n🎉 Done! The admin claim is active.");
        console.log("   Sign out and sign back in to the admin panel to pick up the new token.");
    } catch (err) {
        console.error("\n❌ Error:", err.message || err);
    } finally {
        process.exit(0);
    }
})();
