/**
 * NUTrade Admin Portal & Backend - Firebase Cloud Functions
 * Includes:
 * 1. sendAdminSecurityCode - Sends 6-digit admin 2FA verification code
 * 2. approveListing - Admin function to approve pending listings -> active
 * 3. rejectListing - Admin function to reject pending listings -> rejected
 * 4. createQrPayment - Secure backend integration for PayMongo payments
 * 5. paymongoWebhook - Webhook handler verifying PayMongo signatures & setting status to pending_approval
 */

"use strict";

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Firebase Secrets
const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASS = defineSecret("GMAIL_APP_PASS");
const PAYMONGO_SECRET_KEY = defineSecret("PAYMONGO_SECRET_KEY");
const PAYMONGO_WEBHOOK_SECRET = defineSecret("PAYMONGO_WEBHOOK_SECRET");

/**
 * Helper: Verify if request caller is an authorized administrator
 */
async function verifyAdminCaller(auth) {
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  // 0. Quick fallback for main admin email
  if (auth.token && auth.token.email === "jamesona2904@gmail.com") {
    return true;
  }

  // 1. Check Custom Claim
  if (auth.token && (auth.token.role === "admin" || auth.token.admin === true)) {
    return true;
  }

  // 2. Check admins collection (simple whitelist)
  try {
    const adminDoc = await db.collection("admins").doc(auth.uid).get();
    if (adminDoc.exists) {
      return true;
    }
  } catch (err) {
    console.warn("[NUTrade] admins collection check error:", err.message);
  }

  // 3. Check Firestore users/{uid} record
  try {
    const userDoc = await db.collection("users").doc(auth.uid).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData.role === "admin" && userData.verificationStatus === "verified") {
        return true;
      }
    }
  } catch (err) {
    console.error("[NUTrade Auth Verification Error]", err);
  }

  throw new HttpsError("permission-denied", "Admins only.");
}

/**
 * Callable function: sendAdminSecurityCode
 */
exports.sendAdminSecurityCode = onCall(
  {
    secrets: [GMAIL_USER, GMAIL_APP_PASS],
    enforceAppCheck: false,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in required."
      );
    }

    const { email, code } = request.data || {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new HttpsError("invalid-argument", "A valid email address is required.");
    }

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      throw new HttpsError("invalid-argument", "A valid 6-digit numeric code is required.");
    }

    const callerEmail = request.auth.token.email;
    if (callerEmail && callerEmail.toLowerCase() !== email.toLowerCase()) {
      throw new HttpsError(
        "permission-denied",
        "Security code may only be sent to the authenticated admin email."
      );
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER.value(),
        pass: GMAIL_APP_PASS.value(),
      },
    });

    const mailOptions = {
      from: `"NUTrade Admin Security" <${GMAIL_USER.value()}>`,
      to: email,
      subject: "🔐 Your NUTrade Admin Security Code",
      text: `Your NUTrade Admin security code is: ${code}\n\nThis code expires in 3 minutes. Do not share it with anyone.`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0; padding:0; font-family: 'Segoe UI', Arial, sans-serif; background: #F4F6F8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow: 0 4px 24px rgba(0,43,91,0.10);">
          <tr>
            <td style="background: #002B5B; padding: 28px 36px; text-align:center;">
              <div style="display:inline-block; background: #D4A017; color:#002B5B; font-weight:800; font-size:1rem; letter-spacing:0.1em; padding: 4px 14px; border-radius:6px; margin-bottom:10px;">ADMIN</div>
              <div style="color:#FFFFFF; font-size:1.35rem; font-weight:700;">NUTrade Admin Portal</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px;">
              <h1 style="font-size:1.2rem; font-weight:800; color:#002B5B; text-align:center;">Admin Security Verification</h1>
              <p style="font-size:0.88rem; color:#64748B; text-align:center;">Use the code below to access the Admin Console for <strong>${email}</strong>.</p>
              <div style="background:#F8FAFC; border:2px solid #002B5B; border-radius:12px; padding:24px; text-align:center;">
                <div style="font-family: monospace; font-size:2.4rem; font-weight:900; letter-spacing:0.35em; color:#002B5B;">${code}</div>
                <div style="font-size:0.75rem; color:#94A3B8; margin-top:10px;">Expires in 3 minutes</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`[NUTrade] Security code email sent to ${email}`);
      return { success: true };
    } catch (sendError) {
      console.error("[NUTrade] Failed to send security code email:", sendError);
      throw new HttpsError("internal", "Failed to send security code email.");
    }
  }
);

/**
 * Callable function: approveListing
 * Secure backend operation to transition a listing from pending_approval to active
 */
exports.approveListing = onCall(
  { enforceAppCheck: false },
  async (request) => {
    // 1 & 2. Verify Auth & Admin privilege
    await verifyAdminCaller(request.auth);

    const { listingId } = request.data || {};
    if (!listingId || typeof listingId !== "string") {
      throw new HttpsError("invalid-argument", "A valid listingId string is required.");
    }

    const listingRef = db.collection("listings").doc(listingId);

    // 3. Transactional update
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(listingRef);
      if (!doc.exists) {
        throw new HttpsError("not-found", `Listing ${listingId} not found.`);
      }

      const data = doc.data();

      // 4. Verify precondition: must be pending_approval
      if (data.status !== "pending_approval") {
        throw new HttpsError(
          "failed-precondition",
          `Only listings in 'pending_approval' status can be approved. Current status: '${data.status}'.`
        );
      }

      const now = new Date();
      let durationHours = data.durationHours || (data.durationDays ? data.durationDays * 24 : 24);
      if (typeof durationHours !== "number" || durationHours <= 0) {
        durationHours = 24;
      }
      const endsAt = new Date(now.getTime() + durationHours * 3600 * 1000);

      const updatePayload = {
        status: "active",
        isVisible: true,                // mobile app feed query uses this field
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedBy: request.auth.token.email || request.auth.uid,
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        auctionEndsAt: admin.firestore.Timestamp.fromDate(endsAt),
        auctionEndsAtIso: endsAt.toISOString(),  // some mobile apps use ISO string
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      transaction.update(listingRef, updatePayload);
      return { sellerUid: data.sellerUid || data.ownerUid, title: data.title || data.name };
    });

    // 5. Send Notification to seller (non-blocking notification)
    if (result && result.sellerUid) {
      db.collection("notifications").add({
        userId: result.sellerUid,
        type: "listing_approved",
        title: "Listing Approved! 🎉",
        body: `Your listing "${result.title || "Item"}" has been approved by admin and is now active in the marketplace.`,
        listingId: listingId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isRead: false
      }).catch(err => console.warn("[Notification Log] Approval notification write warning:", err.message));
    }

    console.log(`[NUTrade Approval] Listing ${listingId} approved by admin ${request.auth.uid}`);
    return {
      success: true,
      listingId: listingId,
      status: "active"
    };
  }
);

/**
 * Callable function: rejectListing
 * Secure backend operation to transition a listing from pending_approval to rejected
 */
exports.rejectListing = onCall(
  { enforceAppCheck: false },
  async (request) => {
    // 1 & 2. Verify Auth & Admin privilege
    await verifyAdminCaller(request.auth);

    const { listingId, rejectionReason } = request.data || {};
    if (!listingId || typeof listingId !== "string") {
      throw new HttpsError("invalid-argument", "A valid listingId string is required.");
    }

    let trimmedReason = "";
    if (rejectionReason && typeof rejectionReason === "string") {
      trimmedReason = rejectionReason.trim().substring(0, 500);
    }

    const listingRef = db.collection("listings").doc(listingId);

    // 3. Transactional update
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(listingRef);
      if (!doc.exists) {
        throw new HttpsError("not-found", `Listing ${listingId} not found.`);
      }

      const data = doc.data();

      // 4. Verify precondition: must be pending_approval
      if (data.status !== "pending_approval") {
        throw new HttpsError(
          "failed-precondition",
          `Only listings in 'pending_approval' status can be rejected. Current status: '${data.status}'.`
        );
      }

      const updatePayload = {
        status: "rejected",
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectedBy: request.auth.token.email || request.auth.uid,
        rejectionReason: trimmedReason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      transaction.update(listingRef, updatePayload);
      return { sellerUid: data.sellerUid, title: data.title };
    });

    // 5. Send Notification to seller
    if (result && result.sellerUid) {
      db.collection("notifications").add({
        userId: result.sellerUid,
        type: "listing_rejected",
        title: "Listing Moderation Notice",
        body: `Your listing "${result.title || "Item"}" was not approved.${trimmedReason ? ` Reason: ${trimmedReason}` : ""}`,
        listingId: listingId,
        rejectionReason: trimmedReason,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isRead: false
      }).catch(err => console.warn("[Notification Log] Rejection notification write warning:", err.message));
    }

    console.log(`[NUTrade Rejection] Listing ${listingId} rejected by admin ${request.auth.uid}`);
    return {
      success: true,
      listingId: listingId,
      status: "rejected"
    };
  }
);

/**
 * Callable function: createQrPayment
 * Creates PayMongo payment intent on the backend without exposing secret key
 */
exports.createQrPayment = onCall(
  {
    secrets: [PAYMONGO_SECRET_KEY],
    enforceAppCheck: false
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const { listingId, amount, packageType } = request.data || {};
    if (!listingId || !amount) {
      throw new HttpsError("invalid-argument", "listingId and amount are required.");
    }

    const secretKey = PAYMONGO_SECRET_KEY.value();
    if (!secretKey) {
      throw new HttpsError("failed-precondition", "PayMongo API key is unconfigured.");
    }

    // Call PayMongo API securely
    try {
      const authHeader = `Basic ${Buffer.from(secretKey + ":").toString("base64")}`;
      const response = await fetch("https://api.paymongo.com/v1/payment_intents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader
        },
        body: JSON.stringify({
          data: {
            attributes: {
              amount: Math.round(amount * 100), // convert PHP to centavos
              payment_method_allowed: ["qrph", "paymaya", "gcash"],
              currency: "PHP",
              description: `NUTrade Listing Fee - ${packageType || "Standard"} (ID: ${listingId})`,
              metadata: {
                listingId: listingId,
                userId: request.auth.uid,
                packageType: packageType || "Standard"
              }
            }
          }
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.errors?.[0]?.detail || "PayMongo payment intent creation failed.");
      }

      return {
        success: true,
        paymentIntentId: resData.data.id,
        clientKey: resData.data.attributes.client_key,
        status: resData.data.attributes.status
      };
    } catch (err) {
      console.error("[PayMongo Create Payment Error]", err);
      throw new HttpsError("internal", err.message || "Failed to create PayMongo payment.");
    }
  }
);

/**
 * HTTPS Function: paymongoWebhook
 * Webhook handler for PayMongo payment verification
 * Crucial rule: Transitions listing from pending_payment -> pending_approval (NEVER active!)
 */
exports.paymongoWebhook = onRequest(
  {
    secrets: [PAYMONGO_WEBHOOK_SECRET],
    cors: false
  },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const webhookSecret = PAYMONGO_WEBHOOK_SECRET.value();
    const signatureHeader = req.headers["paymongo-signature"];

    // 1. Signature Verification
    if (webhookSecret && signatureHeader) {
      try {
        const parts = signatureHeader.split(",");
        let timestamp = "";
        let testSignature = "";
        let liveSignature = "";

        parts.forEach(part => {
          const [key, value] = part.split("=");
          if (key.trim() === "t") timestamp = value.trim();
          if (key.trim() === "te") testSignature = value.trim();
          if (key.trim() === "li") liveSignature = value.trim();
        });

        const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
        const payloadToSign = `${timestamp}.${rawBody}`;
        const computedSignature = crypto
          .createHmac("sha256", webhookSecret)
          .update(payloadToSign)
          .digest("hex");

        const targetSignature = liveSignature || testSignature;
        if (targetSignature && computedSignature !== targetSignature) {
          console.warn("[PayMongo Webhook] Invalid signature verification attempt.");
          return res.status(400).send("Invalid webhook signature");
        }
      } catch (sigErr) {
        console.error("[PayMongo Signature Verification Error]", sigErr);
        return res.status(400).send("Webhook signature verification failed");
      }
    }

    // 2. Event Processing
    const event = req.body?.data;
    if (!event) {
      return res.status(400).send("Missing event data");
    }

    const eventType = event.attributes?.type;
    console.log(`[PayMongo Webhook] Processing event type: ${eventType}`);

    if (eventType === "payment.paid" || eventType === "source.chargeable" || eventType === "payment_intent.succeeded") {
      const resourceData = event.attributes?.data?.attributes || event.attributes;
      const metadata = resourceData?.metadata || {};
      const listingId = metadata.listingId;
      const userId = metadata.userId;
      const packageType = metadata.packageType || "Standard Post";
      const amount = (resourceData.amount || 0) / 100;

      if (listingId) {
        try {
          const listingRef = db.collection("listings").doc(listingId);
          await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(listingRef);
            if (doc.exists) {
              const currentStatus = doc.data().status;
              // Update from pending_payment -> pending_approval ONLY!
              if (currentStatus === "pending_payment" || currentStatus === "draft") {
                transaction.update(listingRef, {
                  status: "pending_approval",
                  paymentStatus: "paid",
                  paidAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
              }
            }
          });

          // Log transaction ledger
          const paymentId = event.id || `pay_pm_${Date.now()}`;
          await db.collection("transactions").doc(paymentId).set({
            paymentId: paymentId,
            payMongoIntentId: resourceData.payment_intent_id || event.id || "",
            userId: userId || "",
            userEmail: metadata.userEmail || "",
            listingId: listingId,
            packageType: packageType,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            amount: amount,
            status: "paid"
          }, { merge: true });

          console.log(`[PayMongo Webhook] Listing ${listingId} payment verified -> moved to pending_approval.`);
        } catch (dbErr) {
          console.error("[PayMongo Webhook DB Error]", dbErr);
        }
      }
    }

    return res.status(200).json({ received: true });
  }
);
