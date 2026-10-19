/**
 * NUTrade Admin Web Portal - Firebase JavaScript Interop Layer
 * Encapsulates Firebase Authentication, Cloud Firestore Realtime Listeners,
 * callable Cloud Functions and Firebase Storage URL resolution.
 *
 * Every value surfaced to the admin console comes from project nutrade-a25c7.
 * When a read fails the console receives an empty list plus an
 * OnListenerError callback - never sample data.
 */

window.NUTradeFirebase = (function () {
    let firebaseConfig = {
        apiKey: "AIzaSyDXWnLMuCkcnVUeNRnJLmeRVVXDZ7KXWXo",
        authDomain: "nutrade-a25c7.firebaseapp.com",
        projectId: "nutrade-a25c7",
        storageBucket: "nutrade-a25c7.firebasestorage.app",
        messagingSenderId: "958710637059",
        appId: "1:958710637059:web:7e7b6fe776a4d7958aa436",
        measurementId: "G-9NYKC8WLYM"
    };

    let isInitialized = false;
    let authInstance = null;
    let dbInstance = null;
    let storageInstance = null;
    // Blazor callbacks per listener key, used to re-attach listeners after auth changes
    let activeSubscriptions = new Map();
    // Live Firestore onSnapshot unsubscribe functions (key -> unsub)
    let liveUnsubscribers = new Map();
    let livePaymentsMap = new Map();
    let pendingListingsSub = null;
    let activeListingsSub = null;
    let allListingsSub = null;
    let isPaymentsListenerActive = false;
    let inactivityInterval = null;
    let inactivityDotNetHelper = null;
    let onActivityHandler = null;
    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];

    // The app's Cloud Functions live in asia-southeast1. Listing moderation must
    // go through them: the app's Firestore rules refuse direct writes to
    // /listings, and the callables also set the auction clock and feed slot.
    const APP_FUNCTIONS_REGION = "asia-southeast1";
    let appFunctionsInstance = null;

    function getAppCallable(name) {
        try {
            if (!window.firebase || typeof window.firebase.app !== "function") return null;
            if (!appFunctionsInstance) {
                appFunctionsInstance = window.firebase.app().functions(APP_FUNCTIONS_REGION);
            }
            return appFunctionsInstance.httpsCallable(name);
        } catch (err) {
            console.error("NUTrade: could not resolve callable '" + name + "' in " + APP_FUNCTIONS_REGION + " -", err.message || err);
            return null;
        }
    }

    // All collections (listings, users, payments, admin_security_codes)
    // live in the shared "(default)" Firestore database.
    const WEB_PANEL_DB = "(default)";

    function webPanelDocUrl(path) {
        return "https://firestore.googleapis.com/v1/projects/" + firebaseConfig.projectId +
            "/databases/" + WEB_PANEL_DB + "/documents/" + path;
    }

    async function webPanelRequest(method, path, fields) {
        if (!authInstance || !authInstance.currentUser) {
            throw new Error("Not signed in; cannot reach the " + WEB_PANEL_DB + " database.");
        }

        const idToken = await authInstance.currentUser.getIdToken();
        const opts = {
            method: method,
            headers: {
                "Authorization": "Bearer " + idToken,
                "Content-Type": "application/json"
            }
        };
        if (fields) opts.body = JSON.stringify({ fields: fields });

        const res = await fetch(webPanelDocUrl(path), opts);
        if (res.status === 404) return null;
        if (!res.ok) {
            throw new Error(method + " " + path + " -> " + res.status + " " + (await res.text()));
        }
        const text = await res.text();
        return text ? JSON.parse(text) : {};
    }

    function toRestFields(obj) {
        const fields = {};
        Object.keys(obj).forEach(k => {
            const v = obj[k];
            fields[k] = (v === null || v === undefined)
                ? { nullValue: null }
                : { stringValue: String(v) };
        });
        return fields;
    }

    function fromRestFields(doc) {
        const out = {};
        const fields = (doc && doc.fields) || {};
        Object.keys(fields).forEach(k => {
            const f = fields[k];
            if (f.stringValue !== undefined) out[k] = f.stringValue;
            else if (f.integerValue !== undefined) out[k] = Number(f.integerValue);
            else if (f.doubleValue !== undefined) out[k] = Number(f.doubleValue);
            else if (f.booleanValue !== undefined) out[k] = f.booleanValue;
            else if (f.timestampValue !== undefined) out[k] = f.timestampValue;
            else out[k] = null;
        });
        return out;
    }

    function asText(value) {
        if (typeof value === "string") return value.trim();
        if (typeof value === "number" && isFinite(value)) return String(value);
        return "";
    }

    // ---------------------------------------------------------------
    // Payments helpers
    // ---------------------------------------------------------------

    // payments/{id}.status: awaiting_payment, paid, failed or expired (createQrPayment,
    // settleListingFee, paymongoWebhook, expireStalePayments).
    function isPaidStatus(status) {
        return (status || "").toString().trim().toLowerCase() === "paid";
    }

    // A payment counts as settled only when its status says so, or - for records
    // that carry no status - when paymongoWebhook stamped paidAt.
    function isPaidPayment(p) {
        if (!p) return false;
        if (p.status) return isPaidStatus(p.status);
        return !!p.paidAt;
    }

    // createQrPayment stores payments/{id}.amount in centavos.
    function paymentAmountPesos(p) {
        return (Number(p.amount) || 0) / 100;
    }

    function numberValue(value) {
        const n = Number(value);
        return isFinite(n) ? n : 0;
    }

    // Stored package names are Free / Additional / Priority.
    function packageLabel(raw) {
        const text = asText(raw);
        const lower = text.toLowerCase();
        if (!text) return "";
        if (lower.includes("priority")) return "Priority Pin";
        if (lower.includes("additional") || lower.includes("standard")) return "Standard Post";
        if (lower.includes("free")) return "Free";
        return text;
    }

    const REVENUE_DESK_KEYS = ["revenueCounter", "revenueTransactions", "forfeitedDeposits", "payoutQueue", "disputeQueue"];

    // ---------------------------------------------------------------
    // Storage photo resolution
    // ---------------------------------------------------------------

    // Listing photos may be stored as download URLs or as Storage paths
    // (gs://bucket/... or listings/{id}/photo.jpg). Paths are resolved once and
    // cached; the listing snapshots are re-emitted when a URL arrives.
    const storageUrlCache = new Map();
    let storageReprocessTimer = null;

    function photoPath(p) {
        if (typeof p === "string") return p.trim();
        if (p && typeof p === "object") {
            const keys = ["url", "downloadUrl", "downloadURL", "src", "imageUrl", "path", "storagePath", "fullPath"];
            for (const k of keys) {
                if (typeof p[k] === "string" && p[k].trim()) return p[k].trim();
            }
        }
        return "";
    }

    function resolvePhotoUrl(raw) {
        const path = photoPath(raw);
        if (!path) return "";
        if (/^(https?:|data:|blob:)/i.test(path)) return path;
        if (storageUrlCache.has(path)) return storageUrlCache.get(path);
        if (!storageInstance) return "";

        storageUrlCache.set(path, "");
        let ref;
        try {
            ref = path.toLowerCase().startsWith("gs://")
                ? storageInstance.refFromURL(path)
                : storageInstance.ref(path.replace(/^\/+/, ""));
        } catch (err) {
            console.warn("NUTrade: invalid Storage photo path '" + path + "' -", err.message || err);
            return "";
        }

        ref.getDownloadURL().then(url => {
            storageUrlCache.set(path, url);
            if (storageReprocessTimer) clearTimeout(storageReprocessTimer);
            storageReprocessTimer = setTimeout(() => {
                storageReprocessTimer = null;
                reprocessAndPublishListings();
            }, 250);
        }).catch(err => {
            console.warn("NUTrade: could not resolve Storage photo '" + path + "' -", err.code || err.message || err);
        });
        return "";
    }

    // ---------------------------------------------------------------
    // Listings normalization
    // ---------------------------------------------------------------

    function reprocessAndPublishListings() {
        if (pendingListingsSub && pendingListingsSub.snap) {
            processAndEmitListings(pendingListingsSub.snap, pendingListingsSub.dotNetHelper, pendingListingsSub.methodName, true);
        }
        if (activeListingsSub && activeListingsSub.snap) {
            processAndEmitListings(activeListingsSub.snap, activeListingsSub.dotNetHelper, activeListingsSub.methodName, false);
        }
        if (allListingsSub && allListingsSub.snap) {
            processAndEmitListings(allListingsSub.snap, allListingsSub.dotNetHelper, allListingsSub.methodName, false);
        }
    }

    function normalizeListingDoc(d, isPending) {
        const rawData = sanitizeFirestoreData(d.data() || {});
        const data = { ...rawData };
        data.id = d.id;
        data.sellerUid = data.sellerUid || data.ownerUid || data.userId || data.createdBy || data.uid || "";

        // paidPackage is stamped only by createQrPayment (free first post) and
        // settleListingFee (PayMongo-confirmed fee), so it is proof of settlement.
        const stampedPkg = asText(rawData.paidPackage).toLowerCase();

        ensurePaymentsListener();
        const payDoc = livePaymentsMap.get(d.id);
        if (payDoc) {
            if (!data.sellerUid && payDoc.uid) {
                data.sellerUid = payDoc.uid;
            }
            // Use the real status on the /payments record. Never default to "paid".
            data.paymentStatus = (payDoc.status || rawData.paymentStatus || "").toString().trim().toLowerCase();
            if (!data.paymentStatus && payDoc.paid) data.paymentStatus = "paid";
            // An expired QR attempt does not outweigh a fee or free post settled later.
            if (!payDoc.paid && stampedPkg) data.paymentStatus = stampedPkg === "free" ? "free" : "paid";
            data.paymentId = payDoc.paymentId || "";
            data.payMongoIntentId = payDoc.payMongoIntentId || "";
        } else {
            // No /payments record joined on listingId (Free posts never create one).
            const rawPayStatus = (rawData.paymentStatus || "").toString().trim().toLowerCase();
            const rawStatus = (rawData.status || "").toString().trim().toLowerCase();
            const rawPkg0 = (rawData.paidPackage || rawData.package || rawData.packageType || "")
                .toString().trim().toLowerCase();

            if (stampedPkg) {
                data.paymentStatus = stampedPkg === "free" ? "free" : "paid";
            } else if (rawPayStatus) {
                data.paymentStatus = rawPayStatus;
            } else if (rawData.paidAt) {
                data.paymentStatus = "paid";
            } else if (rawStatus === "pending_payment") {
                data.paymentStatus = "unpaid";
            } else if (rawPkg0 && rawPkg0 !== "free") {
                // A chargeable package with no payment proof is outstanding, not paid.
                data.paymentStatus = "unpaid";
            } else {
                data.paymentStatus = "free";
            }
        }

        // Keep the app's real status; only supply one when the document has none,
        // so the C# model does not fall back to its "active" default.
        data.status = (rawData.status || "").toString().trim() || "pending_approval";

        data.title = data.title || data.name || data.itemName || data.productName || data.itemTitle || "Untitled Listing";
        data.description = data.description || data.desc || data.details || "";
        data.category = data.category || data.itemCategory || data.categoryOther || "General";
        data.condition = asText(rawData.condition);
        data.campusZone = asText(rawData.campusZone);
        data.winnerUid = asText(rawData.winnerUid || rawData.winningBidderUid || rawData.buyerUid);

        // Handle Centavos (mobile app format) vs Pesos (admin format)
        const startCentavos = data.startingBidCentavos ?? data.startingPriceCentavos ?? data.priceCentavos ?? null;
        const startPesos = (startCentavos !== null && !isNaN(startCentavos))
            ? (Number(startCentavos) / 100)
            : Number(data.startingPrice || data.price || data.startingBid || data.basePrice || 0);
        data.startingPrice = startPesos;

        const curBidCentavos = data.currentHighestBidCentavos ?? data.highestBidCentavos ?? data.currentBidCentavos ?? null;
        const curBidPesos = (curBidCentavos !== null && !isNaN(curBidCentavos))
            ? (Number(curBidCentavos) / 100)
            : Number(data.currentHighestBid || data.highestBid || data.currentBid || startPesos);
        data.currentHighestBid = curBidPesos;

        const resCentavos = data.reservePriceCentavos ?? null;
        const resPesos = (resCentavos !== null && !isNaN(resCentavos))
            ? (Number(resCentavos) / 100)
            : Number(data.reservePrice || data.minPrice || 0);
        data.reservePrice = resPesos;

        data.totalBids = Number(data.totalBids ?? data.bidCount ?? 0) || 0;
        data.createdAt = data.createdAt || data.timestamp || data.dateCreated || data.submittedForApprovalAt || null;

        data.sellerName = data.sellerName || data.ownerName || data.userName || data.displayName || "";
        data.sellerEmail = data.sellerEmail || data.ownerEmail || data.userEmail || data.email || "";

        // Map package to standard names: "Priority Pin", "Standard Post", "Free".
        // paidPackage is what was actually settled; `package` is only the draft's choice.
        const rawPkg = (rawData.paidPackage || rawData.package || rawData.packageType || "").toString().trim().toLowerCase();
        if (rawPkg.includes("priority") || data.isPinned || data.isPriority) {
            data.paidPackage = "Priority Pin";
            data.isPinned = true;
        } else if (rawPkg.includes("additional") || rawPkg.includes("standard")) {
            data.paidPackage = "Standard Post";
            data.isPinned = false;
        } else if (!data.paidPackage || data.paidPackage === "free" || rawPkg.includes("free")) {
            data.paidPackage = "Free";
            data.isPinned = false;
        }

        if (isPending) {
            // Collapse spelling variants of "awaiting approval" only. 'draft' and
            // 'pending_payment' are DIFFERENT states and must survive - the admin
            // approval gate depends on them (a draft is not approvable, and
            // pending_payment means the fee is still outstanding).
            const curSt = (data.status || "").toString().toLowerCase().trim();
            if (!curSt || curSt === "pending" || curSt === "pendingapproval") {
                data.status = "pending_approval";
            }
        }

        // Photos normalization - guarantee a List<string> of displayable URLs
        let photos;
        if (Array.isArray(data.photos)) {
            photos = data.photos;
        } else if (data.photos && typeof data.photos === "object") {
            photos = Object.values(data.photos);
        } else if (Array.isArray(data.images)) {
            photos = data.images;
        } else if (data.imageUrl) {
            photos = [data.imageUrl];
        } else if (data.photoUrl) {
            photos = [data.photoUrl];
        } else {
            photos = [];
        }
        data.photos = photos.map(resolvePhotoUrl).filter(Boolean);
        data.imageUrl = data.photos.length ? data.photos[0] : "";

        return data;
    }

    function processAndEmitListings(docs, dotNetHelper, methodName, isPending) {
        const list = [];
        docs.forEach(d => {
            list.push(normalizeListingDoc(d, isPending));
        });
        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
    }

    function ensurePaymentsListener() {
        if (!dbInstance || isPaymentsListenerActive) return;
        isPaymentsListenerActive = true;
        try {
            const unsub = dbInstance.collection("payments").onSnapshot(snap => {
                livePaymentsMap.clear();
                snap.forEach(d => {
                    const pData = sanitizeFirestoreData(d.data());
                    if (pData) {
                        const payObj = {
                            paymentId: d.id,
                            payMongoIntentId: pData.paymongoIntentId || pData.payMongoIntentId || "",
                            uid: pData.uid || pData.userId || "",
                            package: pData.package || pData.packageType || "",
                            amount: Number(pData.amount) || 0,
                            status: pData.status || "",
                            paid: isPaidPayment(pData),
                            createdAt: pData.paidAt || pData.createdAt || ""
                        };
                        if (pData.listingId) {
                            // A listing can have several QR attempts; the settled one wins.
                            const existing = livePaymentsMap.get(pData.listingId);
                            if (!existing || !existing.paid || payObj.paid) {
                                livePaymentsMap.set(pData.listingId, payObj);
                            }
                        }
                        livePaymentsMap.set("id_" + d.id, payObj);
                    }
                });
                console.log("NUTrade: Live payments synced (" + livePaymentsMap.size + " records).");
                reprocessAndPublishListings();
            }, err => {
                console.warn("NUTrade payments read warning:", err.message);
                isPaymentsListenerActive = false;
            });
            storeLiveUnsubscriber("payments_sync", unsub);
        } catch (e) {
            isPaymentsListenerActive = false;
            console.warn("NUTrade payments listener error:", e);
        }
    }

    function registerCallback(key, dotNetHelper, methodName) {
        if (!activeSubscriptions.has(key)) activeSubscriptions.set(key, []);
        const subs = activeSubscriptions.get(key);
        const already = subs.some(s => s.dotNetHelper === dotNetHelper && s.methodName === methodName);
        if (!already) {
            subs.push({ dotNetHelper, methodName });
        }
    }

    function storeLiveUnsubscriber(key, unsub) {
        if (liveUnsubscribers.has(key)) {
            try { liveUnsubscribers.get(key)(); } catch (e) { /* ignore */ }
        }
        liveUnsubscribers.set(key, unsub);
    }

    function unsubscribeAll() {
        for (const [key, unsub] of liveUnsubscribers.entries()) {
            try {
                unsub();
            } catch (e) {
                console.warn(`NUTrade: Failed to unsubscribe '${key}':`, e);
            }
        }
        liveUnsubscribers.clear();
        activeSubscriptions.clear();
        isPaymentsListenerActive = false;
        pendingListingsSub = null;
        activeListingsSub = null;
        allListingsSub = null;
    }

    function rebindAllActiveListeners() {
        if (!dbInstance) return;
        console.log("NUTrade: Refreshing live Firestore listeners on shared (default) database...");
        for (const [key, subs] of activeSubscriptions.entries()) {
            if (subs && subs.length > 0) {
                const firstSub = subs[0];
                if (key === "pendingListings") {
                    window.NUTradeFirebase.subscribeToPendingApprovalListings(firstSub.dotNetHelper, firstSub.methodName);
                } else if (key === "listings") {
                    window.NUTradeFirebase.subscribeToListings(firstSub.dotNetHelper, firstSub.methodName);
                } else if (key === "allListings") {
                    window.NUTradeFirebase.subscribeToAllListings(firstSub.dotNetHelper, firstSub.methodName);
                } else if (key === "verifications") {
                    window.NUTradeFirebase.subscribeToPendingVerifications(firstSub.dotNetHelper, firstSub.methodName);
                } else if (key === "allUsers") {
                    window.NUTradeFirebase.subscribeToAllUsers(firstSub.dotNetHelper, firstSub.methodName);
                } else if (key === "metrics") {
                    window.NUTradeFirebase.subscribeToMetrics(firstSub.dotNetHelper, firstSub.methodName);
                } else if (key === "transactions") {
                    window.NUTradeFirebase.subscribeToTransactions(firstSub.dotNetHelper, firstSub.methodName);
                }
            }
        }
    }

    function reportListenerError(dotNetHelper, methodName, source, err) {
        try {
            dotNetHelper.invokeMethodAsync(methodName, "[]");
            dotNetHelper.invokeMethodAsync("OnListenerError", source, ((err && err.code) || "") + " " + ((err && err.message) || ""));
        } catch (e) {
            console.warn("NUTrade: could not report listener error for " + source, e);
        }
    }

    // Read-only diagnostic: on the first live snapshot, report what the mobile
    // app actually stored in /listings (doc count, status values, owner field,
    // field names). Logs only - never writes and never alters a document.
    let listingsStructureLogged = false;
    function logListingsStructureOnce(snap) {
        if (listingsStructureLogged) return;
        listingsStructureLogged = true;

        try {
            const statuses = {};
            const ownerFields = {};
            let firstId = null;
            let firstKeys = null;

            snap.forEach(d => {
                const data = d.data() || {};
                if (!firstId) {
                    firstId = d.id;
                    firstKeys = Object.keys(data).sort();
                }
                const st = data.status === undefined ? "(no status field)" : String(data.status);
                statuses[st] = (statuses[st] || 0) + 1;
                ["ownerUid", "sellerUid", "userId", "createdBy", "uid"].forEach(f => {
                    if (data[f]) ownerFields[f] = (ownerFields[f] || 0) + 1;
                });
            });

            console.log("NUTrade /listings diagnostic ----------------------------");
            console.log("  documents readable:", snap.size);
            console.log("  status values:", statuses);
            console.log("  owner field present:", ownerFields);
            if (firstId) {
                console.log("  sample doc id:", firstId);
                console.log("  sample doc fields:", firstKeys);
            }
            console.log("--------------------------------------------------------");
        } catch (e) {
            console.warn("NUTrade listings diagnostic warning:", e);
        }
    }

    function sanitizeFirestoreData(obj) {
        if (!obj || typeof obj !== "object") return obj;
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const val = obj[key];
                if (val && typeof val === "object") {
                    if (typeof val.toDate === "function") {
                        obj[key] = val.toDate().toISOString();
                    } else if (typeof val.seconds === "number" && typeof val.nanoseconds === "number") {
                        obj[key] = new Date(val.seconds * 1000).toISOString();
                    } else {
                        sanitizeFirestoreData(val);
                    }
                }
            }
        }
        return obj;
    }

    function getAppCallable(name) {
        if (typeof window.firebase !== "undefined" && typeof window.firebase.functions === "function") {
            try {
                return window.firebase.app().functions("asia-southeast1").httpsCallable(name);
            } catch (e) {
                return window.firebase.functions().httpsCallable(name);
            }
        }
        return null;
    }

    function normalizeUserDoc(d) {
        const data = sanitizeFirestoreData(d.data() || {});
        data.uid = d.id;
        data.displayName = data.displayName || data.name || data.fullName || (data.firstName ? (data.firstName + " " + (data.lastName || "")) : "") || data.email || "Student User";
        data.firstName = data.firstName || (data.displayName ? data.displayName.split(" ")[0] : "") || data.name || "";
        data.lastName = data.lastName || (data.displayName ? data.displayName.split(" ").slice(1).join(" ") : "") || "";
        // users/{uid}.program exactly as the app stores it (SACE, SAHS, SABM, SHS);
        // `program` below falls back to other fields for display only.
        data.programRaw = asText(data.program);
        data.program = data.program || data.course || data.department || data.degree || data.major || "";
        data.photoUrl = data.photoUrl || data.photoURL || data.profileImage || data.avatar || "";
        data.createdAt = data.createdAt || data.created_at || data.timestamp || data.registeredAt || data.joinedAt || data.submittedAt || data.dateCreated || null;
        return data;
    }

    return {
        // Initialize the Firebase SDK (loaded from index.html)
        initFirebase: async function (config) {
            if (config) firebaseConfig = config;
            try {
                if (typeof window.firebase !== "undefined") {
                    if (!window.firebase.apps.length) {
                        window.firebase.initializeApp(firebaseConfig);
                    }
                    authInstance = window.firebase.auth();
                    dbInstance = window.firebase.firestore();
                    try {
                        storageInstance = typeof window.firebase.storage === "function" ? window.firebase.storage() : null;
                    } catch (storageErr) {
                        storageInstance = null;
                        console.warn("NUTrade: Firebase Storage unavailable -", storageErr.message || storageErr);
                    }

                    if (!isInitialized) {
                        isInitialized = true;
                        console.log("NUTrade: Firebase SDK initialized for project nutrade-a25c7 on (default) database.");

                        authInstance.onAuthStateChanged(user => {
                            if (user) {
                                console.log("NUTrade: Auth state active (" + user.email + "). Syncing live Firestore collections.");
                                rebindAllActiveListeners();
                            }
                        });
                    }
                } else {
                    console.error("NUTrade: Firebase SDK failed to load. Check the network connection and reload.");
                }
            } catch (err) {
                console.error("NUTrade: Firebase init failed:", err);
            }

            // Initialize EmailJS for admin security code email delivery
            try {
                if (typeof emailjs !== "undefined") {
                    emailjs.init("40C3_6SwME3k-0QAs");
                }
            } catch (ejsErr) {
                console.warn("NUTrade: EmailJS init warning:", ejsErr);
            }

            return true;
        },

        // Invoke one of the app's callable Cloud Functions (asia-southeast1).
        // Returns { success, data, errorCode, errorMessage }.
        callAppFunction: async function (name, payload, forceTokenRefresh) {
            if (!isInitialized) await this.initFirebase();

            if (forceTokenRefresh && authInstance && authInstance.currentUser) {
                try {
                    await authInstance.currentUser.getIdToken(true);
                } catch (tErr) {
                    console.warn("NUTrade: getIdToken(true) warning:", tErr);
                }
            }

            const callable = getAppCallable(name);
            if (!callable) {
                return {
                    success: false,
                    data: null,
                    errorCode: "unavailable",
                    errorMessage: "Cloud Functions are unavailable. Check the network connection and reload."
                };
            }

            try {
                const res = await callable(payload || {});
                const data = res && res.data !== undefined ? res.data : null;
                const rejected = !!data && typeof data === "object" && (data.success === false || data.ok === false);
                return {
                    success: !rejected,
                    data: data && typeof data === "object" ? sanitizeFirestoreData(data) : data,
                    errorCode: rejected ? "rejected" : null,
                    errorMessage: rejected ? String(data.message || data.error || "The request was rejected.") : null
                };
            } catch (err) {
                const code = (err && err.code ? String(err.code) : "").replace(/^functions\//, "");
                console.error("NUTrade: callable '" + name + "' failed -", code, (err && err.message) || err);
                return {
                    success: false,
                    data: null,
                    errorCode: code || "internal",
                    errorMessage: (err && err.message) || "The request failed."
                };
            }
        },

        // 1. Firebase Authentication & RBAC Verification Flow
        signInWithEmailPassword: async function (email, password) {
            if (!authInstance && window.NUTradeFirebase) {
                window.NUTradeFirebase.initFirebase();
            }
            // Check real Firebase Auth if loaded and configured
            if (authInstance) {
                try {
                    const cred = await authInstance.signInWithEmailAndPassword(email, password);
                    const uid = cred.user.uid;

                    // Admin rights come from the custom claim ONLY. The app's rules
                    // and callables do not trust an email allowlist, an /admins doc,
                    // or `role` on the user's profile document. Force-refresh so a
                    // claim granted since the last sign-in is picked up.
                    let claimIsAdmin = false;
                    let token = null;
                    try {
                        const tokenResult = await cred.user.getIdTokenResult(true);
                        token = tokenResult.token;
                        const claims = tokenResult.claims || {};
                        claimIsAdmin = claims.role === "admin" || claims.admin === true;
                        console.log("NUTrade: admin custom claim present:", claimIsAdmin);
                    } catch (claimErr) {
                        console.error("NUTrade: could not read admin custom claim -", claimErr.message || claimErr);
                    }

                    // Query users/{uid} for profile details only; it never grants admin rights.
                    let profile = null;
                    if (dbInstance) {
                        try {
                            const userDoc = await dbInstance.collection("users").doc(uid).get();
                            if (userDoc.exists) {
                                profile = userDoc.data();
                                profile.uid = uid;
                            }
                        } catch (docErr) {
                            console.warn("NUTrade: Firestore user profile query error:", docErr);
                        }
                    }

                    if (!claimIsAdmin) {
                        await authInstance.signOut();
                        return {
                            success: false,
                            errorMessage: "Unauthorized access: Admin privileges required."
                        };
                    }

                    if (!profile) {
                        // Fallback user object if user document does not exist yet in Firestore
                        profile = {
                            uid: uid,
                            email: cred.user.email || email,
                            displayName: cred.user.displayName || "NU Admin Officer",
                            role: "admin",
                            verificationStatus: "verified",
                            canPost: true,
                            canBid: true,
                            canChat: true,
                            emailVerified: cred.user.emailVerified
                        };
                    } else {
                        profile.emailVerified = cred.user.emailVerified;
                    }

                    // Claim already verified above, so it - not the profile document -
                    // decides admin rights. A profile that still says "student" must
                    // not lock out an account the app has granted the claim to.
                    profile.role = "admin";
                    if (!profile.verificationStatus) {
                        profile.verificationStatus = "verified";
                    }

                    // Check Firebase Auth emailVerified status
                    if (!cred.user.emailVerified && !claimIsAdmin) {
                        try {
                            await cred.user.sendEmailVerification();
                            console.info("NUTrade: Verification email sent to:", cred.user.email || email);
                        } catch (sendErr) {
                            console.warn("NUTrade: Send email verification warning:", sendErr);
                        }
                        await authInstance.signOut();
                        return {
                            success: false,
                            isEmailUnverified: true,
                            unverifiedEmail: cred.user.email || email,
                            errorMessage: "Your admin account email (" + (cred.user.email || email) + ") is not yet verified. A verification email has been sent to your inbox."
                        };
                    } else if (claimIsAdmin) {
                        profile.emailVerified = true;
                    }

                    return {
                        success: true,
                        token: token,
                        user: profile
                    };
                } catch (err) {
                    return {
                        success: false,
                        errorMessage: err.message || "Firebase Authentication failed."
                    };
                }
            }

            return {
                success: false,
                errorMessage: "Firebase Authentication is not initialized or offline."
            };
        },

        // Second-factor codes live in the shared "(default)" database.
        saveSecurityCodeHash: async function (uid, codeHash, expiresAtIso) {
            if (!authInstance || !authInstance.currentUser) return false;

            if (dbInstance) {
                try {
                    await dbInstance.collection("admin_security_codes").doc(uid).set({
                        uid: uid,
                        codeHash: codeHash,
                        expiresAt: expiresAtIso,
                        updatedAt: new Date().toISOString()
                    });
                    return true;
                } catch (err) {
                    console.warn("NUTrade: direct saveSecurityCodeHash failed, trying REST fallback -", err.message || err);
                }
            }
            try {
                await webPanelRequest("PATCH", "admin_security_codes/" + uid, toRestFields({
                    uid: uid,
                    codeHash: codeHash,
                    expiresAt: expiresAtIso,
                    updatedAt: new Date().toISOString()
                }));
                return true;
            } catch (err) {
                console.error("NUTrade: saveSecurityCodeHash FAILED -", err.message || err);
                return false;
            }
        },

        getSecurityCodeHash: async function (uid) {
            if (!authInstance || !authInstance.currentUser) return null;

            if (dbInstance) {
                try {
                    const snap = await dbInstance.collection("admin_security_codes").doc(uid).get();
                    if (snap.exists) {
                        return snap.data();
                    }
                } catch (err) {
                    console.warn("NUTrade: direct getSecurityCodeHash failed, trying REST fallback -", err.message || err);
                }
            }
            try {
                const doc = await webPanelRequest("GET", "admin_security_codes/" + uid);
                return doc ? fromRestFields(doc) : null;
            } catch (err) {
                console.error("NUTrade: getSecurityCodeHash FAILED -", err.message || err);
                return null;
            }
        },

        deleteSecurityCodeHash: async function (uid) {
            if (!authInstance || !authInstance.currentUser) return true;

            if (dbInstance) {
                try {
                    await dbInstance.collection("admin_security_codes").doc(uid).delete();
                } catch (err) {
                    console.warn("NUTrade: direct deleteSecurityCodeHash failed, trying REST fallback -", err.message || err);
                }
            }
            try {
                await webPanelRequest("DELETE", "admin_security_codes/" + uid);
            } catch (err) {
                console.warn("NUTrade: deleteSecurityCodeHash warning -", err.message || err);
            }
            return true;
        },

        sendSecurityCodeEmail: async function (email, code) {
            // Send security code email via EmailJS
            if (typeof emailjs === "undefined") {
                throw new Error("EmailJS SDK not loaded. Check internet connection.");
            }
            try {
                const result = await emailjs.send(
                    "service_97qtn05",    // EmailJS Service ID
                    "template_wszaakb",   // EmailJS Template ID
                    {
                        to_email: email,
                        to_name: "NUTrade Admin",
                        security_code: code,
                        passcode: code,
                        otp: code,
                        message: code
                    }
                    // Public key is already set via emailjs.init() above
                );
                console.log("[NUTrade] Security code email sent via EmailJS. Status:", result.status, result.text);
                return true;
            } catch (emailErr) {
                console.error("[NUTrade] EmailJS send error (full):", JSON.stringify(emailErr));
                const msg = emailErr.text || emailErr.message || JSON.stringify(emailErr) || "Unknown EmailJS error.";
                throw new Error("Failed to send security code email: " + msg);
            }
        },

        sendEmailVerification: async function (targetEmail) {
            if (authInstance && authInstance.currentUser) {
                try {
                    await authInstance.currentUser.sendEmailVerification();
                    return true;
                } catch (err) {
                    console.warn("NUTrade: Send email verification exception:", err);
                }
            }
            console.info("NUTrade: Verification email requested for:", targetEmail || "user");
            return true;
        },

        signOut: async function () {
            unsubscribeAll();
            if (authInstance) {
                await authInstance.signOut();
            }
            return true;
        },

        // Explicit cleanup for Blazor Dispose / logout paths
        unsubscribeAll: function () {
            unsubscribeAll();
            return true;
        },

        // 2. Real-time revenue metrics from counters/revenue (maintained by the app's functions)
        subscribeToMetrics: function (dotNetHelper, methodName) {
            const key = "metrics";
            registerCallback(key, dotNetHelper, methodName);

            if (!dbInstance) {
                dotNetHelper.invokeMethodAsync(methodName, JSON.stringify({ grossRevenue: 0, totalTransactionsCount: 0 }));
                return "sub_metrics_offline";
            }

            const unsub = dbInstance.collection("counters").doc("revenue").onSnapshot(doc => {
                const c = doc.exists ? sanitizeFirestoreData(doc.data() || {}) : {};
                dotNetHelper.invokeMethodAsync(methodName, JSON.stringify({
                    grossRevenue: numberValue(c.grossCentavos) / 100,
                    totalTransactionsCount: numberValue(c.transactionCount),
                    lastUpdated: c.updatedAt || null
                }));
            }, err => {
                console.warn("Metrics listener warning:", err.message);
                try {
                    dotNetHelper.invokeMethodAsync("OnListenerError", "metrics", (err.code || "") + " " + (err.message || ""));
                } catch (e) { /* ignore */ }
            });
            storeLiveUnsubscriber(key, unsub);
            return "sub_metrics_live";
        },

        // 3. Pending Verifications Queue Listener
        subscribeToPendingVerifications: function (dotNetHelper, methodName) {
            const key = "verifications";
            registerCallback(key, dotNetHelper, methodName);

            if (!dbInstance) {
                dotNetHelper.invokeMethodAsync(methodName, "[]");
                return "sub_verifications_offline";
            }

            const unsub = dbInstance.collection("users")
                .where("verificationStatus", "==", "pending")
                .onSnapshot(snap => {
                    const list = [];
                    snap.forEach(d => list.push(normalizeUserDoc(d)));
                    dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                }, err => {
                    console.warn("Verifications listener error:", err.message);
                    reportListenerError(dotNetHelper, methodName, "verifications", err);
                });
            storeLiveUnsubscriber(key, unsub);
            return "sub_verifications_live";
        },

        subscribeToAllUsers: function (dotNetHelper, methodName) {
            const key = "allUsers";
            registerCallback(key, dotNetHelper, methodName);

            if (!dbInstance) {
                dotNetHelper.invokeMethodAsync(methodName, "[]");
                return "sub_allusers_offline";
            }

            const unsub = dbInstance.collection("users")
                .onSnapshot(snap => {
                    const list = [];
                    snap.forEach(d => list.push(normalizeUserDoc(d)));
                    dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                }, err => {
                    console.warn("AllUsers listener error:", err.message);
                    reportListenerError(dotNetHelper, methodName, "allUsers", err);
                });
            storeLiveUnsubscriber(key, unsub);
            return "sub_allusers_live";
        },

        subscribeToPendingApprovalListings: async function (dotNetHelper, methodName) {
            const key = "pendingListings";
            registerCallback(key, dotNetHelper, methodName);

            if (!dbInstance) {
                dotNetHelper.invokeMethodAsync(methodName, "[]");
                return "sub_pending_listings_offline";
            }

            await this.ensureAuthSession();
            ensurePaymentsListener();
            const unsub = dbInstance.collection("listings")
                .onSnapshot(snap => {
                    const pendingDocs = [];
                    snap.forEach(d => {
                        const data = d.data() || {};
                        if (data.status === "pending_approval") {
                            pendingDocs.push(d);
                        }
                    });
                    pendingListingsSub = { snap: pendingDocs, dotNetHelper, methodName };
                    processAndEmitListings(pendingDocs, dotNetHelper, methodName, true);
                }, err => {
                    console.error("NUTrade: pending listings listener error -", err.code || "", err.message || err);
                    if (err.code === "permission-denied" && (!authInstance || !authInstance.currentUser)) {
                        console.log("NUTrade: Waiting for Auth token to initialize live listings...");
                    } else {
                        reportListenerError(dotNetHelper, methodName, "pendingListings", err);
                    }
                });
            storeLiveUnsubscriber(key, unsub);
            return "sub_pending_listings_live";
        },

        // Approve / reject ONLY through the app's callables. They set the auction
        // clock and feed slot and notify the seller; a direct write would skip
        // all of that, and the app's rules refuse it anyway.
        approveListing: async function (listingId) {
            return await this.callAppFunction("approveListing", { listingId: listingId }, true);
        },

        rejectListing: async function (listingId, rejectionReason) {
            const reason = rejectionReason || "Does not comply with marketplace guidelines.";
            return await this.callAppFunction("rejectListing", { listingId: listingId, reason: reason }, true);
        },

        subscribeToListings: async function (dotNetHelper, methodName) {
            const key = "listings";
            registerCallback(key, dotNetHelper, methodName);

            if (!dbInstance) {
                dotNetHelper.invokeMethodAsync(methodName, "[]");
                return "sub_listings_offline";
            }

            await this.ensureAuthSession();
            ensurePaymentsListener();
            const unsub = dbInstance.collection("listings")
                .onSnapshot(snap => {
                    logListingsStructureOnce(snap);
                    const activeDocs = [];
                    snap.forEach(d => {
                        const data = d.data() || {};
                        if (data.status === "active") {
                            activeDocs.push(d);
                        }
                    });
                    activeListingsSub = { snap: activeDocs, dotNetHelper, methodName };
                    processAndEmitListings(activeDocs, dotNetHelper, methodName, false);
                }, err => {
                    console.error("NUTrade: active listings listener error -", err.code || "", err.message || err);
                    if (err.code === "permission-denied" && (!authInstance || !authInstance.currentUser)) {
                        console.log("NUTrade: Waiting for Auth token to initialize active listings...");
                    } else {
                        reportListenerError(dotNetHelper, methodName, "listings", err);
                    }
                });
            storeLiveUnsubscriber(key, unsub);
            return "sub_listings_live";
        },

        // Every listing regardless of status: drafts, live, settled, expired,
        // traded. Identical query to the two above, so the SDK shares one target.
        subscribeToAllListings: async function (dotNetHelper, methodName) {
            const key = "allListings";
            registerCallback(key, dotNetHelper, methodName);

            if (!dbInstance) {
                dotNetHelper.invokeMethodAsync(methodName, "[]");
                return "sub_all_listings_offline";
            }

            await this.ensureAuthSession();
            ensurePaymentsListener();
            const unsub = dbInstance.collection("listings")
                .onSnapshot(snap => {
                    const docs = [];
                    snap.forEach(d => docs.push(d));
                    allListingsSub = { snap: docs, dotNetHelper, methodName };
                    processAndEmitListings(docs, dotNetHelper, methodName, false);
                }, err => {
                    console.error("NUTrade: all listings listener error -", err.code || "", err.message || err);
                    if (err.code === "permission-denied" && (!authInstance || !authInstance.currentUser)) {
                        console.log("NUTrade: Waiting for Auth token to initialize all listings...");
                    } else {
                        reportListenerError(dotNetHelper, methodName, "allListings", err);
                    }
                });
            storeLiveUnsubscriber(key, unsub);
            return "sub_all_listings_live";
        },

        // 5. Payments ledger (/payments, written by createQrPayment / paymongoWebhook)
        subscribeToTransactions: function (dotNetHelper, methodName) {
            const key = "transactions";
            registerCallback(key, dotNetHelper, methodName);

            if (!dbInstance) {
                dotNetHelper.invokeMethodAsync(methodName, "[]");
                return "sub_transactions_offline";
            }

            // Pre-fetch users map so we map uid -> user email / name
            const userEmailMap = new Map();
            dbInstance.collection("users").get().then(uSnap => {
                uSnap.forEach(ud => {
                    const uData = ud.data();
                    userEmailMap.set(ud.id, uData.email || uData.userEmail || uData.displayName || uData.name || ud.id);
                });
            }).catch(() => { });

            const unsub = dbInstance.collection("payments")
                .onSnapshot(snap => {
                    const list = [];
                    snap.forEach(d => {
                        const data = sanitizeFirestoreData(d.data());

                        const pkgType = packageLabel(data.package || data.packageType);

                        const uid = data.uid || data.userId || "";
                        const email = data.userEmail || data.email || userEmailMap.get(uid) || (uid ? `Student (${uid.substring(0, Math.min(8, uid.length))}...)` : "Unknown payer");

                        let status = (data.status || "").toString().trim().toLowerCase();
                        if (!status && data.paidAt) status = "paid";

                        list.push({
                            paymentId: d.id,
                            payMongoIntentId: data.paymongoIntentId || data.payMongoIntentId || d.id,
                            userId: uid || "N/A",
                            userEmail: email,
                            listingId: data.listingId || "N/A",
                            packageType: pkgType,
                            timestamp: data.paidAt || data.createdAt || null,
                            qrExpiresAt: data.qrExpiresAt || null,
                            amount: paymentAmountPesos(data),
                            status: status
                        });
                    });

                    list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
                    dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                }, err => {
                    console.warn("Transactions listener error:", err.message);
                    reportListenerError(dotNetHelper, methodName, "transactions", err);
                });
            storeLiveUnsubscriber(key, unsub);
            return "sub_transactions_live";
        },

        // 6. Bid ladder for one listing. App bids store amountCentavos, so no
        // server-side orderBy (Firestore drops documents missing the ordered
        // field); the console sorts by amount after mapping.
        getListingBids: async function (listingId) {
            if (!dbInstance) return [];
            const snap = await dbInstance.collection("listings").doc(listingId)
                .collection("bids")
                .get();
            const bids = [];
            snap.forEach(d => {
                const data = sanitizeFirestoreData(d.data());
                data.id = d.id;
                bids.push(data);
            });
            return bids;
        },

        // Revenue Desk: read-only listeners on the collections the app's functions
        // maintain. Payout and dispute actions go through markPayoutPaid,
        // declinePayout and resolveDispute, never direct writes.
        subscribeToRevenueDesk: async function (dotNetHelper) {
            this.unsubscribeRevenueDesk();
            if (!dbInstance) {
                dotNetHelper.invokeMethodAsync("OnRevenueDeskError", "revenueDesk", "Firestore is not initialized.");
                return false;
            }
            await this.ensureAuthSession();

            const onError = source => err => {
                console.warn("NUTrade: " + source + " listener error -", err.code || "", err.message || err);
                try {
                    dotNetHelper.invokeMethodAsync("OnRevenueDeskError", source, ((err && err.code) || "") + " " + ((err && err.message) || ""));
                } catch (e) { /* ignore */ }
            };

            const emitList = (method, snap, mapDoc) => {
                const list = [];
                snap.forEach(d => list.push(mapDoc(d.id, sanitizeFirestoreData(d.data() || {}))));
                dotNetHelper.invokeMethodAsync(method, JSON.stringify(list));
            };

            storeLiveUnsubscriber("revenueCounter", dbInstance.collection("counters").doc("revenue")
                .onSnapshot(doc => {
                    const c = doc.exists ? sanitizeFirestoreData(doc.data() || {}) : {};
                    dotNetHelper.invokeMethodAsync("OnRevenueCounterReceived", JSON.stringify({
                        exists: doc.exists,
                        grossCentavos: numberValue(c.grossCentavos),
                        transactionCount: numberValue(c.transactionCount),
                        forfeitedDepositsCentavos: numberValue(c.forfeitedDepositsCentavos),
                        updatedAt: c.updatedAt || null
                    }));
                }, onError("revenueCounter")));

            storeLiveUnsubscriber("revenueTransactions", dbInstance.collection("transactions")
                .onSnapshot(snap => emitList("OnRevenueTransactionsReceived", snap, (id, t) => ({
                    paymentId: asText(t.paymentId),
                    payMongoIntentId: asText(t.payMongoIntentId),
                    userId: asText(t.userId),
                    userEmail: asText(t.userEmail),
                    listingId: asText(t.listingId),
                    packageType: packageLabel(t.packageType),
                    amount: (t.amountCentavos !== undefined && t.amountCentavos !== null)
                        ? numberValue(t.amountCentavos) / 100
                        : numberValue(t.amount),
                    status: asText(t.status).toLowerCase(),
                    timestamp: t.timestamp || null
                })), onError("revenueTransactions")));

            storeLiveUnsubscriber("forfeitedDeposits", dbInstance.collection("bidIntents")
                .where("status", "==", "forfeited")
                .onSnapshot(snap => emitList("OnForfeitedDepositsReceived", snap, (id, b) => ({
                    id: id,
                    listingId: asText(b.listingId),
                    listingTitle: asText(b.listingTitle),
                    sellerUid: asText(b.sellerUid),
                    bidderUid: asText(b.bidderUid),
                    amountCentavos: numberValue(b.amountCentavos),
                    depositCentavos: numberValue(b.depositCentavos),
                    status: asText(b.status),
                    createdAt: b.createdAt || null,
                    resolvedAt: b.resolvedAt || null,
                    refundReason: asText(b.refundReason),
                    refundedVia: asText(b.refundedVia),
                    committedBidId: asText(b.committedBidId)
                })), onError("forfeitedDeposits")));

            storeLiveUnsubscriber("payoutQueue", dbInstance.collection("payoutRequests")
                .where("status", "==", "requested")
                .onSnapshot(snap => emitList("OnPayoutQueueReceived", snap, (id, p) => ({
                    id: id,
                    uid: asText(p.uid),
                    amountCentavos: numberValue(p.amountCentavos),
                    method: asText(p.method),
                    accountName: asText(p.accountName),
                    accountNumber: asText(p.accountNumber),
                    status: asText(p.status),
                    createdAt: p.createdAt || null,
                    resolvedAt: p.resolvedAt || null,
                    resolvedBy: asText(p.resolvedBy),
                    declineReason: asText(p.declineReason)
                })), onError("payoutQueue")));

            storeLiveUnsubscriber("disputeQueue", dbInstance.collection("disputes")
                .where("status", "==", "open")
                .onSnapshot(snap => emitList("OnDisputeQueueReceived", snap, (id, x) => ({
                    id: id,
                    chatId: asText(x.chatId),
                    listingId: asText(x.listingId),
                    listingTitle: asText(x.listingTitle),
                    sellerUid: asText(x.sellerUid),
                    buyerUid: asText(x.buyerUid),
                    depositIntentId: asText(x.depositIntentId),
                    depositCentavos: numberValue(x.depositCentavos),
                    note: asText(x.note),
                    status: asText(x.status),
                    createdAt: x.createdAt || null,
                    resolvedAt: x.resolvedAt || null,
                    resolvedBy: asText(x.resolvedBy),
                    resolution: asText(x.resolution)
                })), onError("disputeQueue")));

            return true;
        },

        unsubscribeRevenueDesk: function () {
            REVENUE_DESK_KEYS.forEach(key => {
                if (liveUnsubscribers.has(key)) {
                    try { liveUnsubscribers.get(key)(); } catch (e) { /* ignore */ }
                    liveUnsubscribers.delete(key);
                }
            });
            return true;
        },

        // 7. Session Persistence & 5-Minute Inactivity Auto-Logout
        saveSession: function (user, isSecurityVerified) {
            try {
                const sessionData = {
                    user: user,
                    isSecurityVerified: !!isSecurityVerified,
                    savedAt: Date.now()
                };
                localStorage.setItem("nutrade_admin_session", JSON.stringify(sessionData));
                localStorage.setItem("nutrade_last_activity", Date.now().toString());
            } catch (e) {
                console.warn("NUTrade: Could not save session to localStorage:", e);
            }
        },

        getStoredSession: function () {
            try {
                const sessionRaw = localStorage.getItem("nutrade_admin_session");
                const lastActivityRaw = localStorage.getItem("nutrade_last_activity");
                if (!sessionRaw || !lastActivityRaw) return null;

                const lastActivity = Number(lastActivityRaw);
                const now = Date.now();
                const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

                if (now - lastActivity > INACTIVITY_TIMEOUT_MS) {
                    console.log("NUTrade: Stored session expired due to 5 mins of inactivity.");
                    localStorage.removeItem("nutrade_admin_session");
                    localStorage.removeItem("nutrade_last_activity");
                    return null;
                }

                // Session is active and valid: refresh last activity timestamp
                localStorage.setItem("nutrade_last_activity", now.toString());
                return JSON.parse(sessionRaw);
            } catch (e) {
                console.warn("NUTrade: Error parsing stored session:", e);
                return null;
            }
        },

        ensureAuthSession: async function () {
            if (!authInstance) return false;
            if (authInstance.currentUser) return true;
            return new Promise(resolve => {
                const unsubscribe = authInstance.onAuthStateChanged(user => {
                    unsubscribe();
                    resolve(!!user);
                });
                setTimeout(() => resolve(!!authInstance.currentUser), 1500);
            });
        },

        clearSession: function () {
            try {
                localStorage.removeItem("nutrade_admin_session");
                localStorage.removeItem("nutrade_last_activity");
            } catch (e) { }
            this.stopInactivityTracker();
        },

        startInactivityTracker: function (dotNetHelper) {
            this.stopInactivityTracker();

            inactivityDotNetHelper = dotNetHelper;
            const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (300,000ms)
            let lastUpdate = Date.now();

            onActivityHandler = function () {
                const now = Date.now();
                if (now - lastUpdate > 2000) { // throttle write to localStorage (every 2s)
                    lastUpdate = now;
                    try {
                        localStorage.setItem("nutrade_last_activity", now.toString());
                    } catch (e) { }
                }
            };

            activityEvents.forEach(evt => {
                window.addEventListener(evt, onActivityHandler, { passive: true });
            });

            inactivityInterval = setInterval(function () {
                const lastActStr = localStorage.getItem("nutrade_last_activity");
                const sessionStr = localStorage.getItem("nutrade_admin_session");
                if (!sessionStr) {
                    NUTradeFirebase.stopInactivityTracker();
                    return;
                }

                const lastAct = Number(lastActStr || "0");
                const elapsed = Date.now() - lastAct;

                if (elapsed >= INACTIVITY_TIMEOUT_MS) {
                    console.warn("NUTrade: 5 minutes of inactivity detected. Auto-logging out...");
                    NUTradeFirebase.clearSession();
                    if (authInstance) {
                        authInstance.signOut().catch(() => { });
                    }
                    if (inactivityDotNetHelper) {
                        try {
                            inactivityDotNetHelper.invokeMethodAsync("HandleInactivityTimeout");
                        } catch (err) {
                            window.location.href = "login?reason=inactivity";
                        }
                    } else {
                        window.location.href = "login?reason=inactivity";
                    }
                }
            }, 3000);
        },

        stopInactivityTracker: function () {
            if (inactivityInterval) {
                clearInterval(inactivityInterval);
                inactivityInterval = null;
            }
            if (onActivityHandler) {
                activityEvents.forEach(evt => {
                    window.removeEventListener(evt, onActivityHandler);
                });
                onActivityHandler = null;
            }
            inactivityDotNetHelper = null;
        }
    };
})();
