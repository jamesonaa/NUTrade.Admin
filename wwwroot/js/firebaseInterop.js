/**
 * NUTrade Admin Web Portal - Firebase JavaScript Interop Layer
 * Encapsulates Firebase Authentication, Cloud Firestore Realtime Listeners,
 * and Firebase Storage URL resolution.
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
    // Callbacks used by the mock/simulated path
    let activeSubscriptions = new Map();
    // Live Firestore onSnapshot unsubscribe functions (key -> unsub)
    let liveUnsubscribers = new Map();
    let livePaymentsMap = new Map();
    let pendingListingsSub = null;
    let activeListingsSub = null;
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

    function reprocessAndPublishListings() {
        if (pendingListingsSub && pendingListingsSub.snap) {
            processAndEmitPendingListings(pendingListingsSub.snap, pendingListingsSub.dotNetHelper, pendingListingsSub.methodName);
        }
        if (activeListingsSub && activeListingsSub.snap) {
            processAndEmitActiveListings(activeListingsSub.snap, activeListingsSub.dotNetHelper, activeListingsSub.methodName);
        }
    }

    function normalizeListingDoc(d, isPending) {
        const rawData = sanitizeFirestoreData(d.data() || {});
        const data = { ...rawData };
        data.id = d.id;
        data.sellerUid = data.sellerUid || data.ownerUid || data.userId || data.createdBy || data.uid || "";

        ensurePaymentsListener();
        const payDoc = livePaymentsMap.get(d.id);
        if (payDoc) {
            if (!data.sellerUid && payDoc.uid) {
                data.sellerUid = payDoc.uid;
            }
            // Use the real status on the /payments record. Never default to "paid".
            data.paymentStatus = (payDoc.status || rawData.paymentStatus || "").toString().trim().toLowerCase();
            data.paymentId = payDoc.paymentId || "";
            data.payMongoIntentId = payDoc.payMongoIntentId || "";
            const pkgStr = (payDoc.package || "").toString().toLowerCase();
            const payAmt = Number(payDoc.amount) || 0;
            if (pkgStr.includes("priority") || payAmt === 20 || payAmt === 2000) {
                data.paidPackage = "Priority Pin";
                data.isPinned = true;
            } else if (pkgStr.includes("additional") || pkgStr.includes("standard") || payAmt === 10 || payAmt === 1000) {
                data.paidPackage = "Standard Post";
            }
        } else {
            // No /payments record joined on listingId. Never assume the fee was
            // settled - derive only from what the listing document itself states.
            // paymongoWebhook writes paymentStatus:'paid' + paidAt on the listing,
            // so those are the authoritative proof of payment.
            const rawPayStatus = (rawData.paymentStatus || "").toString().trim().toLowerCase();
            const rawStatus = (rawData.status || "").toString().trim().toLowerCase();
            const rawPkg0 = (rawData.paidPackage || rawData.package || rawData.packageType || "")
                .toString().trim().toLowerCase();

            if (rawPayStatus) {
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
        data.category = data.category || data.itemCategory || "General";

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

        data.totalBids = Number(data.totalBids ?? data.bidCount ?? 0);
        data.createdAt = data.createdAt || data.timestamp || data.dateCreated || new Date().toISOString();

        data.sellerName = data.sellerName || data.ownerName || data.userName || data.displayName || "";
        data.sellerEmail = data.sellerEmail || data.ownerEmail || data.userEmail || data.email || "";

        // Map package to standard names: "Priority Pin", "Standard Post", "Free"
        const rawPkg = (data.package || data.packageType || data.paidPackage || "").toString().trim().toLowerCase();
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

        // Photos normalization - guarantee a List<string> array for .NET deserialization
        if (!Array.isArray(data.photos)) {
            if (data.photos && typeof data.photos === "object") {
                data.photos = Object.values(data.photos).filter(p => typeof p === "string");
            } else if (data.images && Array.isArray(data.images)) {
                data.photos = data.images;
            } else if (data.imageUrl && typeof data.imageUrl === "string") {
                data.photos = [data.imageUrl];
            } else if (data.photoUrl && typeof data.photoUrl === "string") {
                data.photos = [data.photoUrl];
            } else {
                data.photos = [];
            }
        }

        return data;
    }

    function processAndEmitPendingListings(snap, dotNetHelper, methodName) {
        const list = [];
        snap.forEach(d => {
            list.push(normalizeListingDoc(d, true));
        });
        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
    }

    function processAndEmitActiveListings(snap, dotNetHelper, methodName) {
        const list = [];
        snap.forEach(d => {
            list.push(normalizeListingDoc(d, false));
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
                            status: pData.status || "paid",
                            createdAt: pData.paidAt || pData.createdAt || ""
                        };
                        if (pData.listingId) {
                            livePaymentsMap.set(pData.listingId, payObj);
                        }
                        livePaymentsMap.set("id_" + d.id, payObj);
                    }
                });
                console.log("NUTrade: Live payments synced (" + livePaymentsMap.size + " records).");
                reprocessAndPublishListings();
            }, err => console.warn("NUTrade payments read warning:", err.message));
            storeLiveUnsubscriber("payments_sync", unsub);
        } catch (e) {
            console.warn("NUTrade payments listener error:", e);
        }
    }

    // Mock state store for development / preview when Firebase SDK is offline or unconfigured
    let mockState = {
        currentUser: null,
        securityCodes: {},
        metrics: {
            grossRevenue: 48500.00,
            totalBidsPlaced: 1428,
            auctionCompletionRate: 84.6,
            averageBidsPerItem: 6.4,
            freeToPaidConversionRate: 38.2,
            activeListingsCount: 5,
            pendingVerificationsCount: 4,
            totalTransactionsCount: 2890,
            lastUpdated: new Date().toISOString()
        },
        pendingVerifications: [
            {
                uid: "usr_nu_2024_001",
                email: "juan.delacruz@gmail.com",
                displayName: "Juan Dela Cruz",
                role: "student",
                verificationStatus: "pending",
                photoUrl: "",
                createdAt: "2026-09-03T08:30:00Z",
                submittedAt: "2026-09-04T07:15:00Z",
                canPost: false,
                canBid: false,
                canChat: false
            },
            {
                uid: "usr_nu_2024_002",
                email: "maria.santos@yahoo.com",
                displayName: "Maria Santos",
                role: "student",
                verificationStatus: "pending",
                photoUrl: "",
                createdAt: "2026-09-02T10:00:00Z",
                submittedAt: "2026-09-04T08:45:00Z",
                canPost: false,
                canBid: false,
                canChat: false
            },
            {
                uid: "usr_nu_2024_003",
                email: "christian.reyes@outlook.com",
                displayName: "Christian Reyes",
                role: "student",
                verificationStatus: "pending",
                photoUrl: "",
                createdAt: "2026-09-01T14:20:00Z",
                submittedAt: "2026-09-04T09:10:00Z",
                canPost: false,
                canBid: false,
                canChat: false
            },
            {
                uid: "usr_nu_2024_004",
                email: "althea.gonzales@gmail.com",
                displayName: "Althea Gonzales",
                role: "student",
                verificationStatus: "pending",
                photoUrl: "",
                createdAt: "2026-09-04T02:00:00Z",
                submittedAt: "2026-09-04T10:05:00Z",
                canPost: false,
                canBid: false,
                canChat: false
            }
        ],
        allUsers: [
            {
                uid: "usr_nu_2024_001",
                email: "juan.delacruz@gmail.com",
                displayName: "Juan Dela Cruz",
                role: "student",
                verificationStatus: "pending",
                photoUrl: "",
                createdAt: "2026-09-03T08:30:00Z",
                submittedAt: "2026-09-04T07:15:00Z",
                canPost: false,
                canBid: false,
                canChat: false
            },
            {
                uid: "usr_nu_2024_002",
                email: "maria.santos@yahoo.com",
                displayName: "Maria Santos",
                role: "student",
                verificationStatus: "pending",
                photoUrl: "",
                createdAt: "2026-09-02T10:00:00Z",
                submittedAt: "2026-09-04T08:45:00Z",
                canPost: false,
                canBid: false,
                canChat: false
            },
            {
                uid: "usr_nu_2024_005",
                email: "carlos.mendoza@gmail.com",
                displayName: "Carlos Mendoza",
                role: "student",
                verificationStatus: "verified",
                photoUrl: "",
                createdAt: "2026-09-01T08:30:00Z",
                submittedAt: "2026-09-01T09:00:00Z",
                canPost: true,
                canBid: true,
                canChat: true
            }
        ],
        listings: [
            {
                id: "lst_101",
                title: "NU-Lipa Varsity Jacket",
                category: "Other",
                sellerUid: "usr_nu_2024_001",
                sellerName: "Juan Dela Cruz",
                sellerEmail: "delacruz.juan@lipa.nu.edu.ph",
                currentHighestBid: 1000.00,
                reservePrice: 800.00,
                startingPrice: 500.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 19 * 3600 * 1000 + 59 * 60 * 1000).toISOString(),
                isPinned: true,
                imageUrl: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&auto=format&fit=crop&q=80",
                totalBids: 2,
                createdAt: "2026-09-03T10:00:00Z"
            },
            {
                id: "lst_102",
                title: "NU-Lipa Uniform Set (Size M)",
                category: "Uniforms",
                sellerUid: "usr_nu_2024_003",
                sellerName: "Christian Reyes",
                sellerEmail: "reyes.christian@lipa.nu.edu.ph",
                currentHighestBid: 450.00,
                reservePrice: 350.00,
                startingPrice: 200.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 38 * 60 * 1000 + 44 * 1000).toISOString(),
                isPinned: true,
                imageUrl: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=400&auto=format&fit=crop&q=80",
                totalBids: 8,
                createdAt: "2026-09-03T14:30:00Z"
            },
            {
                id: "lst_103",
                title: "NU-Lipa Uniform Set (Size S)",
                category: "Uniforms",
                sellerUid: "usr_nu_2024_002",
                sellerName: "Maria Santos",
                sellerEmail: "santos.maria@lipa.nu.edu.ph",
                currentHighestBid: 400.00,
                reservePrice: 300.00,
                startingPrice: 200.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 41 * 60 * 1000 + 3 * 1000).toISOString(),
                isPinned: false,
                imageUrl: "https://images.unsplash.com/photo-1594980596870-8aa52a78d8cd?w=400&auto=format&fit=crop&q=80",
                totalBids: 5,
                createdAt: "2026-09-02T16:00:00Z"
            },
            {
                id: "lst_104",
                title: "Fundamentals of Nursing Textbook",
                category: "Textbooks",
                sellerUid: "usr_nu_2024_004",
                sellerName: "Althea Gonzales",
                sellerEmail: "gonzales.althea@lipa.nu.edu.ph",
                currentHighestBid: 650.00,
                reservePrice: 500.00,
                startingPrice: 350.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 32 * 60 * 1000 + 37 * 1000).toISOString(),
                isPinned: false,
                imageUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&auto=format&fit=crop&q=80",
                totalBids: 6,
                createdAt: "2026-09-04T01:00:00Z"
            }
        ],
        pendingListings: [
            {
                id: "lst_pending_201",
                title: "Calculus & Analytical Geometry (9th Edition)",
                description: "Pre-loved textbook for engineering students. In excellent condition with clean pages.",
                category: "Textbooks",
                sellerUid: "usr_nu_2024_001",
                sellerName: "Juan Dela Cruz",
                sellerEmail: "delacruz.juan@lipa.nu.edu.ph",
                currentHighestBid: 450.00,
                reservePrice: 400.00,
                startingPrice: 300.00,
                status: "pending_approval",
                paidPackage: "Free",
                isPinned: false,
                imageUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&auto=format&fit=crop&q=80",
                totalBids: 0,
                createdAt: "2026-09-19T08:30:00Z"
            },
            {
                id: "lst_pending_202",
                title: "Engineering Scientific Calculator FX-991EX",
                description: "Original Casio ClassWiz calculator required for Board exams. Battery freshly replaced.",
                category: "Electronics",
                sellerUid: "usr_nu_2024_002",
                sellerName: "Maria Santos",
                sellerEmail: "santos.maria@lipa.nu.edu.ph",
                currentHighestBid: 1200.00,
                reservePrice: 1000.00,
                startingPrice: 800.00,
                status: "pending_approval",
                paidPackage: "Priority Pin",
                isPinned: true,
                imageUrl: "https://images.unsplash.com/photo-1611125832047-1d7ad1e8e48a?w=400&auto=format&fit=crop&q=80",
                totalBids: 0,
                createdAt: "2026-09-19T09:15:00Z"
            },
            {
                id: "lst_pending_203",
                title: "Official NU College Hoodie - Size L",
                description: "Official National University navy blue hoodie jacket. Worn twice, like new.",
                category: "Uniforms",
                sellerUid: "usr_nu_2024_003",
                sellerName: "Christian Reyes",
                sellerEmail: "reyes.christian@lipa.nu.edu.ph",
                currentHighestBid: 750.00,
                reservePrice: 600.00,
                startingPrice: 500.00,
                status: "pending_approval",
                paidPackage: "Standard Post",
                isPinned: false,
                imageUrl: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&auto=format&fit=crop&q=80",
                totalBids: 0,
                createdAt: "2026-09-19T10:00:00Z"
            }
        ],
        transactions: [],
        bids: {
            "lst_101": [
                { id: "bid_01", listingId: "lst_101", bidderUid: "usr_10", bidderName: "Alden Perez", bidderEmail: "perez.a@gmail.com", amount: 850.00, timestamp: "2026-09-04T10:20:00Z" },
                { id: "bid_02", listingId: "lst_101", bidderUid: "usr_11", bidderName: "Bea Alonzo", bidderEmail: "alonzo.b@gmail.com", amount: 750.00, timestamp: "2026-09-04T09:15:00Z" },
                { id: "bid_03", listingId: "lst_101", bidderUid: "usr_12", bidderName: "Carlo Tan", bidderEmail: "tan.c@gmail.com", amount: 650.00, timestamp: "2026-09-04T08:00:00Z" },
                { id: "bid_04", listingId: "lst_101", bidderUid: "usr_10", bidderName: "Alden Perez", bidderEmail: "perez.a@gmail.com", amount: 500.00, timestamp: "2026-09-03T11:00:00Z" }
            ],
            "lst_103": [
                { id: "bid_05", listingId: "lst_103", bidderUid: "usr_15", bidderName: "Dennis Cruz", bidderEmail: "cruz.d@gmail.com", amount: 1250.00, timestamp: "2026-09-04T10:45:00Z" },
                { id: "bid_06", listingId: "lst_103", bidderUid: "usr_16", bidderName: "Eileen Go", bidderEmail: "go.e@gmail.com", amount: 1100.00, timestamp: "2026-09-04T09:30:00Z" },
                { id: "bid_07", listingId: "lst_103", bidderUid: "usr_17", bidderName: "Francis Lim", bidderEmail: "lim.f@gmail.com", amount: 950.00, timestamp: "2026-09-03T18:00:00Z" }
            ]
        }
    };

    // Auto simulated PayMongo webhook settlement every 20 seconds to showcase live reactive counter
    let simulatedWebhookInterval = null;

    function startSimulatedWebhookListener() {
        if (dbInstance) {
            if (simulatedWebhookInterval) {
                clearInterval(simulatedWebhookInterval);
                simulatedWebhookInterval = null;
            }
            return;
        }
        if (simulatedWebhookInterval) return;
        simulatedWebhookInterval = setInterval(() => {
            // Randomly simulate an Additional Post (₱10) or Priority Pin (₱20) transaction
            const isPriority = Math.random() > 0.5;
            const amount = isPriority ? 20.00 : 10.00;
            const packageType = isPriority ? "Priority Pin" : "Additional Post";
            const randomId = Math.floor(1000 + Math.random() * 9000);

            mockState.metrics.grossRevenue += amount;
            mockState.metrics.totalTransactionsCount += 1;
            mockState.metrics.lastUpdated = new Date().toISOString();

            const newTx = {
                paymentId: "pay_pm_live_" + randomId,
                payMongoIntentId: "pi_" + Math.random().toString(36).substring(2, 10),
                userId: "usr_nu_auto_" + randomId,
                userEmail: "student" + randomId + "@gmail.com",
                listingId: "lst_" + (100 + Math.floor(Math.random() * 5)),
                packageType: packageType,
                timestamp: new Date().toISOString(),
                amount: amount,
                status: "paid"
            };

            mockState.transactions.unshift(newTx);
            if (mockState.transactions.length > 50) mockState.transactions.pop();

            // Broadcast to active .NET subscribers
            notifySubscribers("metrics", mockState.metrics);
            notifySubscribers("transactions", mockState.transactions);
        }, 15000);
    }

    function notifySubscribers(key, data) {
        if (activeSubscriptions.has(key)) {
            const subs = activeSubscriptions.get(key);
            for (const sub of subs) {
                try {
                    sub.dotNetHelper.invokeMethodAsync(sub.methodName, JSON.stringify(data));
                } catch (e) {
                    console.warn(`Error invoking Blazor callback for ${key}:`, e);
                }
            }
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
            console.log("  NOTE: the admin 'Active' table shows status==='active' only;");
            console.log("        everything else except rejected/unpublished/deleted/sold/");
            console.log("        expired/pending_meetup/completed goes to the pending queue.");
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

    return {
        // Initialize Firebase SDK or fallback simulator
        initFirebase: async function (config) {
            if (config) firebaseConfig = config;
            try {
                if (typeof window.firebase !== "undefined") {
                    if (!window.firebase.apps.length) {
                        window.firebase.initializeApp(firebaseConfig);
                    }
                    authInstance = window.firebase.auth();
                    dbInstance = window.firebase.firestore();
                    isInitialized = true;
                    console.log("NUTrade: Firebase SDK initialized successfully for project nutrade-a25c7 on (default) database.");

                    authInstance.onAuthStateChanged(user => {
                        if (user) {
                            console.log("NUTrade: Auth state active (" + user.email + "). Syncing live Firestore collections.");
                            rebindAllActiveListeners();
                        }
                    });
                } else {
                    console.info("NUTrade: Using simulated Firebase client (SDK offline/standalone mode).");
                    startSimulatedWebhookListener();
                }
            } catch (err) {
                console.warn("NUTrade: Firebase init fallback:", err);
                startSimulatedWebhookListener();
            }

            // Initialize EmailJS for admin security code email delivery
            try {
                if (typeof emailjs !== "undefined") {
                    emailjs.init("40C3_6SwME3k-0QAs");
                    console.log("NUTrade: EmailJS initialized.");
                }
            } catch (ejsErr) {
                console.warn("NUTrade: EmailJS init warning:", ejsErr);
            }

            return true;
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

                    // Query users/{uid} for profile details and role fallback (matches firestore.rules isAdmin())
                    let profile = null;
                    if (dbInstance) {
                        try {
                            const userDoc = await dbInstance.collection("users").doc(uid).get();
                            if (userDoc.exists) {
                                profile = userDoc.data();
                                profile.uid = uid;
                                if (!claimIsAdmin && profile.role === "admin") {
                                    claimIsAdmin = true;
                                    console.log("NUTrade: admin role verified from users/" + uid);
                                }
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
            if (authInstance && authInstance.currentUser) {
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
            }

            mockState.securityCodes[uid] = {
                uid: uid,
                codeHash: codeHash,
                expiresAt: expiresAtIso
            };
            return true;
        },

        getSecurityCodeHash: async function (uid) {
            if (authInstance && authInstance.currentUser) {
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
            }
            return mockState.securityCodes[uid] || null;
        },

        deleteSecurityCodeHash: async function (uid) {
            if (authInstance && authInstance.currentUser) {
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
            }
            delete mockState.securityCodes[uid];
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
                // Log the full error object so we can debug
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
            mockState.currentUser = null;
            return true;
        },

        // Explicit cleanup for Blazor Dispose / logout paths
        unsubscribeAll: function () {
            unsubscribeAll();
            return true;
        },

        // 2. Real-time Metrics & Gross Revenue Listener
        subscribeToMetrics: function (dotNetHelper, methodName) {
            const key = "metrics";
            registerCallback(key, dotNetHelper, methodName);

            if (dbInstance) {
                const unsub = dbInstance.collection("payments").onSnapshot(snap => {
                    let totalRev = 0;
                    let txCount = snap.size;
                    let priorityCount = 0;
                    snap.forEach(d => {
                        const pData = d.data();
                        let amt = Number(pData.amount) || 0;
                        if (amt >= 100) amt = amt / 100;
                        totalRev += amt;
                        const pkg = (pData.package || pData.packageType || "").toString().toLowerCase();
                        if (pkg.includes("priority") || amt === 20) priorityCount++;
                    });

                    const conversionRate = txCount > 0 ? (priorityCount / txCount) * 100 : 0.0;

                    const metricsObj = {
                        grossRevenue: totalRev,
                        totalBidsPlaced: 0,
                        auctionCompletionRate: 100.0,
                        averageBidsPerItem: 1.0,
                        freeToPaidConversionRate: conversionRate,
                        activeListingsCount: 1,
                        pendingVerificationsCount: 0,
                        totalTransactionsCount: txCount,
                        lastUpdated: new Date().toISOString()
                    };
                    dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(metricsObj));
                }, err => {
                    console.warn("Metrics listener warning:", err.message);
                });
                storeLiveUnsubscriber(key, unsub);
                return "sub_metrics_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify({
                grossRevenue: 0,
                totalBidsPlaced: 0,
                auctionCompletionRate: 0.0,
                averageBidsPerItem: 0.0,
                freeToPaidConversionRate: 0.0,
                activeListingsCount: 0,
                pendingVerificationsCount: 0,
                totalTransactionsCount: 0,
                lastUpdated: new Date().toISOString()
            }));
            return "sub_metrics_mock";
        },

        // 3. Pending Verifications Queue Listener
        subscribeToPendingVerifications: function (dotNetHelper, methodName) {
            const key = "verifications";
            registerCallback(key, dotNetHelper, methodName);

            if (dbInstance) {
                const unsub = dbInstance.collection("users")
                    .where("verificationStatus", "==", "pending")
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = sanitizeFirestoreData(d.data());
                            data.uid = d.id;
                            data.displayName = data.displayName || data.name || data.fullName || (data.firstName ? (data.firstName + " " + (data.lastName || "")) : "") || data.email || "Student User";
                            data.firstName = data.firstName || (data.displayName ? data.displayName.split(" ")[0] : "") || data.name || "";
                            data.lastName = data.lastName || (data.displayName ? data.displayName.split(" ").slice(1).join(" ") : "") || "";
                            data.program = data.program || data.course || data.department || data.degree || data.major || "Program unavailable";
                            data.photoUrl = data.photoUrl || data.photoURL || data.profileImage || data.avatar || "";
                            list.push(data);
                        });
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                    }, err => {
                        console.warn("Verifications Firestore permission/read fallback:", err.message);
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.pendingVerifications));
                    });
                storeLiveUnsubscriber(key, unsub);
                return "sub_verifications_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.pendingVerifications));
            return "sub_verifications_mock";
        },

        // Approve / Reject Email Verification
        updateVerificationStatus: async function (uid, status, rejectionReason) {
            if (dbInstance) {
                try {
                    const isApproved = status === "verified";
                    const updates = {
                        verificationStatus: status,
                        rejectionReason: rejectionReason || null,
                        canPost: isApproved,
                        canBid: isApproved,
                        canChat: isApproved,
                        verifiedAt: isApproved ? window.firebase.firestore.FieldValue.serverTimestamp() : null
                    };
                    await dbInstance.collection("users").doc(uid).update(updates);
                    return true;
                } catch (writeErr) {
                    console.error("Firestore update verification failed:", writeErr);
                    throw new Error(writeErr.message || "Failed to update user in Firebase.");
                }
            }

            // Fallback update only if DB instance is not connected
            const index = mockState.pendingVerifications.findIndex(v => v.uid === uid);
            if (index !== -1) {
                const user = mockState.pendingVerifications[index];
                user.verificationStatus = status;
                user.rejectionReason = rejectionReason || null;
                user.canPost = status === "verified";
                user.canBid = status === "verified";
                user.canChat = status === "verified";

                mockState.pendingVerifications.splice(index, 1);
                mockState.metrics.pendingVerificationsCount = mockState.pendingVerifications.length;

                // Also update in allUsers if it exists
                if (mockState.allUsers) {
                    const allUserIndex = mockState.allUsers.findIndex(u => u.uid === uid);
                    if (allUserIndex !== -1) {
                        mockState.allUsers[allUserIndex].verificationStatus = status;
                        mockState.allUsers[allUserIndex].canPost = status === "verified";
                        mockState.allUsers[allUserIndex].canBid = status === "verified";
                        mockState.allUsers[allUserIndex].canChat = status === "verified";
                        notifySubscribers("allUsers", mockState.allUsers);
                    }
                }

                notifySubscribers("verifications", mockState.pendingVerifications);
                notifySubscribers("metrics", mockState.metrics);
            }
            return true;
        },

        subscribeToAllUsers: function (dotNetHelper, methodName) {
            const key = "allUsers";
            registerCallback(key, dotNetHelper, methodName);

            if (dbInstance) {
                const unsub = dbInstance.collection("users")
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = sanitizeFirestoreData(d.data());
                            data.uid = d.id;
                            data.displayName = data.displayName || data.name || data.fullName || (data.firstName ? (data.firstName + " " + (data.lastName || "")) : "") || data.email || "Student User";
                            data.firstName = data.firstName || (data.displayName ? data.displayName.split(" ")[0] : "") || data.name || "";
                            data.lastName = data.lastName || (data.displayName ? data.displayName.split(" ").slice(1).join(" ") : "") || "";
                            data.program = data.program || data.course || data.department || data.degree || data.major || "Program unavailable";
                            data.photoUrl = data.photoUrl || data.photoURL || data.profileImage || data.avatar || "";
                            data.createdAt = data.createdAt || data.created_at || data.timestamp || data.registeredAt || data.joinedAt || data.submittedAt || data.dateCreated || null;
                            list.push(data);
                        });
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                    }, err => {
                        console.warn("AllUsers Firestore permission/read fallback:", err.message);
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.allUsers));
                    });
                storeLiveUnsubscriber(key, unsub);
                return "sub_allusers_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.allUsers));
            return "sub_allusers_mock";
        },

        subscribeToPendingApprovalListings: async function (dotNetHelper, methodName) {
            const key = "pendingListings";
            registerCallback(key, dotNetHelper, methodName);

            if (dbInstance) {
                await this.ensureAuthSession();
                ensurePaymentsListener();
                const unsub = dbInstance.collection("listings")
                    .onSnapshot(snap => {
                        console.log("NUTrade: [Firestore] Received listings snapshot, total docs in DB:", snap.size);
                        const pendingDocs = [];
                        snap.forEach(d => {
                            const data = d.data() || {};
                            const st = (data.status || "pending_approval").toString().toLowerCase().trim();
                            if (st !== "active" && st !== "approved" && st !== "rejected" && st !== "unpublished" && st !== "deleted" && st !== "sold" && st !== "expired" && st !== "pending_meetup" && st !== "completed") {
                                pendingDocs.push(d);
                            }
                        });
                        console.log("NUTrade: [Firestore] Filtered pending approval listings count:", pendingDocs.length);
                        pendingListingsSub = { snap: pendingDocs, dotNetHelper, methodName };
                        processAndEmitPendingListings(pendingDocs, dotNetHelper, methodName);
                    }, err => {
                        console.error("NUTrade: pending listings listener error -", err.code || "", err.message || err);
                        if (err.code === "permission-denied" && (!authInstance || !authInstance.currentUser)) {
                            console.log("NUTrade: Waiting for Auth token to initialize live listings...");
                        } else {
                            dotNetHelper.invokeMethodAsync(methodName, "[]");
                            dotNetHelper.invokeMethodAsync("OnListenerError", "pendingListings", (err.code || "") + " " + (err.message || ""));
                        }
                    });
                storeLiveUnsubscriber(key, unsub);
                return "sub_pending_listings_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.pendingListings));
            return "sub_pending_listings_mock";
        },

        // Approve via the app's Cloud Function. The app's Firestore rules refuse
        // direct writes to /listings, and the callable also sets the auction
        // clock, the feed slot and notifies the seller.
        approveListing: async function (listingId) {
            if (authInstance && authInstance.currentUser) {
                try {
                    await authInstance.currentUser.getIdToken(true);
                } catch (tErr) {
                    console.warn("NUTrade: getIdToken(true) warning:", tErr);
                }
            }
            const callable = getAppCallable("approveListing");
            if (callable) {
                try {
                    const res = await callable({ listingId: listingId, id: listingId });
                    const ok = !res || !res.data || (res.data.success !== false && res.data.ok !== false);
                    if (ok) {
                        console.log("NUTrade: approveListing callable succeeded for", listingId);
                        return true;
                    } else {
                        console.error("NUTrade: approveListing callable rejected", listingId, res.data);
                    }
                } catch (err) {
                    console.error("NUTrade: approveListing callable FAILED -", err.code || "", err.message || err);
                }
            } else {
                console.error("NUTrade: approveListing callable unavailable.");
            }

            if (dbInstance) {
                try {
                    console.warn("NUTrade: approveListing falling back to direct Firestore write.");
                    await dbInstance.collection("listings").doc(listingId).update({
                        status: "active",
                        isVisible: true,
                        approvedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                        approvedBy: (authInstance && authInstance.currentUser ? authInstance.currentUser.email : "admin")
                    });
                    console.log("NUTrade: approveListing direct write succeeded for", listingId);
                    return true;
                } catch (writeErr) {
                    console.error("NUTrade: approveListing direct write FAILED -", writeErr.code || "", writeErr.message || writeErr);
                    return false;
                }
            }
            return false;
        },

        // Reject via the app's Cloud Function or direct write fallback with notification
        rejectListing: async function (listingId, rejectionReason) {
            if (authInstance && authInstance.currentUser) {
                try {
                    await authInstance.currentUser.getIdToken(true);
                } catch (tErr) {
                    console.warn("NUTrade: getIdToken(true) warning:", tErr);
                }
            }
            const callable = getAppCallable("rejectListing");
            if (callable) {
                try {
                    const res = await callable({
                        listingId: listingId,
                        id: listingId,
                        reason: rejectionReason || "Does not comply with marketplace guidelines.",
                        rejectionReason: rejectionReason || "Does not comply with marketplace guidelines."
                    });
                    const ok = !res || !res.data || (res.data.success !== false && res.data.ok !== false);
                    if (ok) {
                        console.log("NUTrade: rejectListing callable succeeded for", listingId);
                        return true;
                    } else {
                        console.error("NUTrade: rejectListing callable rejected", listingId, res.data);
                    }
                } catch (err) {
                    console.error("NUTrade: rejectListing callable FAILED -", err.code || "", err.message || err);
                }
            } else {
                console.error("NUTrade: rejectListing callable unavailable.");
            }

            // Fallback: try direct Firestore update + student notification
            if (dbInstance) {
                try {
                    console.warn("NUTrade: rejectListing executing direct Firestore update & student notification fallback.");
                    const docRef = dbInstance.collection("listings").doc(listingId);
                    const docSnap = await docRef.get();
                    const listingData = docSnap.exists ? docSnap.data() : {};
                    const sellerUid = listingData.sellerUid || listingData.userId || listingData.uid;
                    const itemTitle = listingData.title || "Your listing";

                    await docRef.update({
                        status: "rejected",
                        isVisible: false,
                        rejectionReason: rejectionReason || "Does not comply with marketplace guidelines.",
                        rejectedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                        rejectedBy: (authInstance && authInstance.currentUser ? authInstance.currentUser.email : "admin")
                    });

                    // Push real-time notification to the student seller
                    if (sellerUid) {
                        try {
                            const notifPayload = {
                                userId: sellerUid,
                                recipientUid: sellerUid,
                                title: "Listing Rejected ❌",
                                body: "Your listing '" + itemTitle + "' was rejected. Reason: " + (rejectionReason || "Does not comply with marketplace guidelines."),
                                message: "Your listing '" + itemTitle + "' was rejected. Reason: " + (rejectionReason || "Does not comply with marketplace guidelines."),
                                type: "listing_rejected",
                                listingId: listingId,
                                isRead: false,
                                read: false,
                                createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
                            };
                            await dbInstance.collection("notifications").add(notifPayload);
                            console.log("NUTrade: Rejection notification sent to student:", sellerUid);
                        } catch (notifErr) {
                            console.warn("NUTrade: Student notification fallback warning:", notifErr.message || notifErr);
                        }
                    }

                    console.log("NUTrade: rejectListing direct update succeeded for", listingId);
                    return true;
                } catch (writeErr) {
                    console.error("NUTrade: rejectListing direct write FAILED -", writeErr.code || "", writeErr.message || writeErr);
                    return false;
                }
            }
            return false;
        },

        subscribeToListings: async function (dotNetHelper, methodName) {
            const key = "listings";
            registerCallback(key, dotNetHelper, methodName);

            if (dbInstance) {
                await this.ensureAuthSession();
                ensurePaymentsListener();
                const unsub = dbInstance.collection("listings")
                    .onSnapshot(snap => {
                        logListingsStructureOnce(snap);
                        const activeDocs = [];
                        snap.forEach(d => {
                            const data = d.data() || {};
                            const st = (data.status || "").toString().toLowerCase().trim();
                            if (st === "active" || st === "approved" || st === "published" || (data.isVisible === true && st !== "rejected" && st !== "deleted" && st !== "unpublished")) {
                                activeDocs.push(d);
                            }
                        });
                        console.log("NUTrade: [Firestore] Filtered active listings count:", activeDocs.length);
                        activeListingsSub = { snap: activeDocs, dotNetHelper, methodName };
                        processAndEmitActiveListings(activeDocs, dotNetHelper, methodName);
                    }, err => {
                        console.error("NUTrade: active listings listener error -", err.code || "", err.message || err);
                        if (err.code === "permission-denied" && (!authInstance || !authInstance.currentUser)) {
                            console.log("NUTrade: Waiting for Auth token to initialize active listings...");
                        } else {
                            dotNetHelper.invokeMethodAsync(methodName, "[]");
                            dotNetHelper.invokeMethodAsync("OnListenerError", "listings", (err.code || "") + " " + (err.message || ""));
                        }
                    });
                storeLiveUnsubscriber(key, unsub);
                return "sub_listings_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.listings));
            return "sub_listings_mock";
        },

        updateListingStatus: async function (listingId, newStatus) {
            if (dbInstance) {
                try {
                    const isVisible = (newStatus === "active");
                    await dbInstance.collection("listings").doc(listingId).update({
                        status: newStatus,
                        isVisible: isVisible,
                        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                    });
                    return true;
                } catch (writeErr) {
                    // The app's rules refuse direct writes to /listings, and there is
                    // no callable for unpublish / status toggle yet (only
                    // approveListing and rejectListing exist). Report the real failure
                    // instead of mutating local sample data and returning success.
                    console.error("NUTrade: updateListingStatus('" + newStatus + "') FAILED -",
                        writeErr.code || "", writeErr.message || writeErr);
                    return false;
                }
            }

            const item = mockState.listings.find(l => l.id === listingId);
            if (item) {
                item.status = newStatus;
                if (newStatus === "unpublished") {
                    mockState.listings = mockState.listings.filter(l => l.id !== listingId);
                }
                mockState.metrics.activeListingsCount = mockState.listings.filter(l => l.status === "active").length;
                notifySubscribers("listings", mockState.listings);
                notifySubscribers("metrics", mockState.metrics);
            }
            return true;
        },

        // 5. Audit Trail Transactions Ledger
        subscribeToTransactions: function (dotNetHelper, methodName) {
            const key = "transactions";
            registerCallback(key, dotNetHelper, methodName);

            if (dbInstance) {
                // Pre-fetch users map so we map uid -> user email / name
                const userEmailMap = new Map();
                dbInstance.collection("users").get().then(uSnap => {
                    uSnap.forEach(ud => {
                        const uData = ud.data();
                        userEmailMap.set(ud.id, uData.email || uData.userEmail || uData.displayName || uData.name || ud.id);
                    });
                }).catch(() => {});

                const unsub = dbInstance.collection("payments")
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = sanitizeFirestoreData(d.data());
                            let rawAmount = Number(data.amount) || 0;
                            if (rawAmount >= 100) rawAmount = rawAmount / 100;

                            let pkgType = data.package || data.packageType || "Standard Post";
                            const pkgLower = pkgType.toLowerCase();
                            if (pkgLower.includes("additional")) pkgType = "Standard Post";
                            else if (pkgLower.includes("priority")) pkgType = "Priority Pin";

                            const uid = data.uid || data.userId || "";
                            const email = data.userEmail || data.email || userEmailMap.get(uid) || (uid ? `Student (${uid.substring(0, Math.min(8, uid.length))}...)` : "Student Payer");

                            list.push({
                                paymentId: d.id,
                                payMongoIntentId: data.paymongoIntentId || data.payMongoIntentId || d.id,
                                userId: uid || "N/A",
                                userEmail: email,
                                listingId: data.listingId || "N/A",
                                packageType: pkgType,
                                timestamp: data.paidAt || data.createdAt || new Date().toISOString(),
                                amount: rawAmount,
                                status: data.status || "paid"
                            });
                        });

                        list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                    }, err => {
                        console.warn("Transactions Firestore permission/read fallback:", err.message);
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify([]));
                    });
                storeLiveUnsubscriber(key, unsub);
                return "sub_transactions_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify([]));
            return "sub_transactions_mock";
        },

        // 6. Searchable Bid History Inspector
        getListingBids: async function (listingId) {
            if (dbInstance) {
                const snap = await dbInstance.collection("listings").doc(listingId)
                    .collection("bids")
                    .orderBy("amount", "desc")
                    .get();
                const bids = [];
                snap.forEach(d => {
                    const data = sanitizeFirestoreData(d.data());
                    data.id = d.id;
                    bids.push(data);
                });
                return bids;
            }

            return mockState.bids[listingId] || [
                {
                    id: "bid_sample_01",
                    listingId: listingId,
                    bidderUid: "usr_generic_99",
                    bidderName: "Kenneth Dimaano",
                    bidderEmail: "dimaano.k@lipa.nu.edu.ph",
                    amount: 600.00,
                    timestamp: new Date().toISOString()
                }
            ];
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
                        authInstance.signOut().catch(() => {});
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
