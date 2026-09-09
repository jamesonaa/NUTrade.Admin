/**
 * NUTrade Admin Web Portal - Firebase JavaScript Interop Layer
 * Encapsulates Firebase Authentication, Cloud Firestore Realtime Listeners,
 * and Firebase Storage URL resolution.
 */

window.NUTradeFirebase = (function () {
    // Config placeholder - will be initialized via initFirebase() or use defaults
    let firebaseConfig = {
        apiKey: "AIzaSyFakeKeyForNUTradeAdminDevMode_ReplaceWithRealKey",
        authDomain: "nutrade-lipa.firebaseapp.com",
        projectId: "nutrade-lipa",
        storageBucket: "nutrade-lipa.appspot.com",
        messagingSenderId: "1234567890",
        appId: "1:1234567890:web:abcdef123456"
    };

    let isInitialized = false;
    let authInstance = null;
    let dbInstance = null;
    let activeSubscriptions = new Map();

    // Mock state store for development / preview when Firebase SDK is offline or unconfigured
    let mockState = {
        currentUser: null,
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
        listings: [
            {
                id: "lst_101",
                title: "Engineering Thermodynamics 8th Edition (Moran & Shapiro)",
                category: "Textbooks & Academic",
                sellerUid: "usr_nu_2024_001",
                sellerName: "Juan Dela Cruz",
                sellerEmail: "delacruz.juan@lipa.nu.edu.ph",
                currentHighestBid: 850.00,
                reservePrice: 600.00,
                startingPrice: 400.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
                isPinned: true,
                imageUrl: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&auto=format&fit=crop&q=80",
                totalBids: 9,
                createdAt: "2026-09-03T10:00:00Z"
            },
            {
                id: "lst_102",
                title: "NU Lipa Official College Polo Uniform (Men's Large - 2 pcs)",
                category: "Uniforms & Apparel",
                sellerUid: "usr_nu_2024_003",
                sellerName: "Christian Reyes",
                sellerEmail: "reyes.christian@lipa.nu.edu.ph",
                currentHighestBid: 450.00,
                reservePrice: 350.00,
                startingPrice: 200.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 18 * 3600 * 1000).toISOString(),
                isPinned: true,
                imageUrl: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=400&auto=format&fit=crop&q=80",
                totalBids: 6,
                createdAt: "2026-09-03T14:30:00Z"
            },
            {
                id: "lst_103",
                title: "Casio fx-991EX ClassWiz Scientific Calculator (Authentic)",
                category: "Electronics & Tech",
                sellerUid: "usr_nu_2024_002",
                sellerName: "Maria Santos",
                sellerEmail: "santos.maria@lipa.nu.edu.ph",
                currentHighestBid: 1250.00,
                reservePrice: 1000.00,
                startingPrice: 800.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 1 * 3600 * 1000 + 45 * 60 * 1000).toISOString(),
                isPinned: false,
                imageUrl: "https://images.unsplash.com/photo-1594980596870-8aa52a78d8cd?w=400&auto=format&fit=crop&q=80",
                totalBids: 14,
                createdAt: "2026-09-02T16:00:00Z"
            },
            {
                id: "lst_104",
                title: "Drafting Table Board with T-Square and Technical Drawing Kit",
                category: "Architecture & Drafting",
                sellerUid: "usr_nu_2024_005",
                sellerName: "Carlos Mendoza",
                sellerEmail: "mendoza.carlos@lipa.nu.edu.ph",
                currentHighestBid: 1600.00,
                reservePrice: 1500.00,
                startingPrice: 1000.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 32 * 3600 * 1000).toISOString(),
                isPinned: false,
                imageUrl: "https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=400&auto=format&fit=crop&q=80",
                totalBids: 8,
                createdAt: "2026-09-04T01:00:00Z"
            },
            {
                id: "lst_105",
                title: "Nursing Scrub Suit Navy Blue (Small) with Stethoscope Bag",
                category: "Allied Health & Nursing",
                sellerUid: "usr_nu_2024_004",
                sellerName: "Althea Gonzales",
                sellerEmail: "gonzales.althea@lipa.nu.edu.ph",
                currentHighestBid: 550.00,
                reservePrice: 500.00,
                startingPrice: 300.00,
                status: "active",
                auctionEndsAt: new Date(Date.now() + 11 * 3600 * 1000).toISOString(),
                isPinned: true,
                imageUrl: "https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=400&auto=format&fit=crop&q=80",
                totalBids: 5,
                createdAt: "2026-09-04T05:00:00Z"
            }
        ],
        transactions: [
            {
                paymentId: "pay_pm_live_9941a823",
                payMongoIntentId: "pi_9a7c3b2e1f0a4d5e",
                userId: "usr_nu_2024_001",
                userEmail: "juan.delacruz@gmail.com",
                listingId: "lst_101",
                packageType: "Priority Pin",
                timestamp: "2026-09-04T10:42:15Z",
                amount: 20.00,
                status: "paid"
            },
            {
                paymentId: "pay_pm_live_9941a824",
                payMongoIntentId: "pi_1b8d4c3f2a1b5e6f",
                userId: "usr_nu_2024_003",
                userEmail: "christian.reyes@gmail.com",
                listingId: "lst_102",
                packageType: "Priority Pin",
                timestamp: "2026-09-04T09:18:04Z",
                amount: 20.00,
                status: "paid"
            },
            {
                paymentId: "pay_pm_live_9941a825",
                payMongoIntentId: "pi_2c9e5d4a3b2c6f7a",
                userId: "usr_nu_2024_002",
                userEmail: "maria.santos@gmail.com",
                listingId: "lst_103",
                packageType: "Standard Post",
                timestamp: "2026-09-04T08:55:40Z",
                amount: 10.00,
                status: "paid"
            },
            {
                paymentId: "pay_pm_live_9941a826",
                payMongoIntentId: "pi_3d0f6e5b4c3d7a8b",
                userId: "usr_nu_2024_005",
                userEmail: "carlos.mendoza@gmail.com",
                listingId: "lst_104",
                packageType: "Standard Post",
                timestamp: "2026-09-04T07:12:19Z",
                amount: 10.00,
                status: "paid"
            },
            {
                paymentId: "pay_pm_live_9941a827",
                payMongoIntentId: "pi_4e1a7f6c5d4e8b9c",
                userId: "usr_nu_2024_004",
                userEmail: "althea.gonzales@gmail.com",
                listingId: "lst_105",
                packageType: "Priority Pin",
                timestamp: "2026-09-04T05:22:33Z",
                amount: 20.00,
                status: "paid"
            }
        ],
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
                    console.log("NUTrade: Firebase SDK initialized successfully.");
                } else {
                    console.info("NUTrade: Using simulated Firebase client (SDK offline/standalone mode).");
                }
            } catch (err) {
                console.warn("NUTrade: Firebase init fallback:", err);
            }
            startSimulatedWebhookListener();
            return true;
        },

        // 1. Firebase Authentication & RBAC Verification Flow
        signInWithEmailPassword: async function (email, password) {
            // Check real Firebase Auth if loaded and configured
            if (authInstance) {
                try {
                    const cred = await authInstance.signInWithEmailAndPassword(email, password);
                    const uid = cred.user.uid;
                    const token = await cred.user.getIdToken();

                    // Query users/{uid} for role check
                    const userDoc = await dbInstance.collection("users").doc(uid).get();
                    if (!userDoc.exists) {
                        await authInstance.signOut();
                        return {
                            success: false,
                            errorMessage: "User profile record not found in Firestore."
                        };
                    }

                    const profile = userDoc.data();
                    profile.uid = uid;

                    // RBAC Validation: role == 'admin' AND verificationStatus == 'verified'
                    if (profile.role !== "admin" || profile.verificationStatus !== "verified") {
                        await authInstance.signOut();
                        return {
                            success: false,
                            errorMessage: "Unauthorized access: Admin privileges required."
                        };
                    }

                    return {
                        success: true,
                        token: token,
                        user: profile
                    };
                } catch (err) {
                    return {
                        success: false,
                        errorMessage: err.message || "Authentication failed."
                    };
                }
            }

            // Standalone / Simulation mode handler:
            // Allows test admin accounts: admin@lipa.nu.edu.ph or any email containing 'admin'
            await new Promise(r => setTimeout(r, 600));

            const isNuAdmin = email.toLowerCase().includes("admin") || email.toLowerCase() === "admin@lipa.nu.edu.ph";
            const isUnverifiedAdmin = email.toLowerCase().includes("unverified");

            if (!isNuAdmin && !isUnverifiedAdmin) {
                return {
                    success: false,
                    errorMessage: "Unauthorized access: Admin privileges required."
                };
            }

            if (isUnverifiedAdmin) {
                return {
                    success: false,
                    errorMessage: "Unauthorized access: Admin privileges required. Your account verificationStatus is pending."
                };
            }

            // Valid Admin Mock Profile
            const adminUser = {
                uid: "admin_nu_lipa_root",
                email: email,
                displayName: "NU Lipa Admin Officer",
                studentNumber: "ADM-2024-001",
                role: "admin",
                verificationStatus: "verified",
                photoUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
                studentIdCardUrl: "",
                createdAt: "2024-01-01T00:00:00Z",
                canPost: true,
                canBid: true,
                canChat: true
            };

            mockState.currentUser = adminUser;
            return {
                success: true,
                token: "mock_jwt_token_admin_nu_lipa_" + Date.now(),
                user: adminUser
            };
        },

        signOut: async function () {
            if (authInstance) {
                await authInstance.signOut();
            }
            mockState.currentUser = null;
            return true;
        },

        // 2. Real-time Metrics & Gross Revenue Listener
        subscribeToMetrics: function (dotNetHelper, methodName) {
            const key = "metrics";
            if (!activeSubscriptions.has(key)) activeSubscriptions.set(key, []);
            activeSubscriptions.get(key).push({ dotNetHelper, methodName });

            if (dbInstance) {
                const unsub = dbInstance.collection("system").doc("metrics")
                    .onSnapshot(doc => {
                        if (doc.exists) {
                            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(doc.data()));
                        }
                    }, err => console.error("Metrics listen error", err));
                return "sub_metrics_live";
            }

            // Immediately send current metrics
            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.metrics));
            return "sub_metrics_mock";
        },

        // 3. Pending Verifications Queue Listener
        subscribeToPendingVerifications: function (dotNetHelper, methodName) {
            const key = "verifications";
            if (!activeSubscriptions.has(key)) activeSubscriptions.set(key, []);
            activeSubscriptions.get(key).push({ dotNetHelper, methodName });

            if (dbInstance) {
                const unsub = dbInstance.collection("users")
                    .where("verificationStatus", "==", "pending")
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = d.data();
                            data.uid = d.id;
                            list.push(data);
                        });
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                    }, err => console.error("Verifications listen error", err));
                return "sub_verifications_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.pendingVerifications));
            return "sub_verifications_mock";
        },

        // Approve / Reject Email Verification
        updateVerificationStatus: async function (uid, status, rejectionReason) {
            if (dbInstance) {
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
            }

            // Mock update
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

                notifySubscribers("verifications", mockState.pendingVerifications);
                notifySubscribers("metrics", mockState.metrics);
            }
            return true;
        },

        // 4. Listing Moderation & Realtime Active Listings
        subscribeToListings: function (dotNetHelper, methodName) {
            const key = "listings";
            if (!activeSubscriptions.has(key)) activeSubscriptions.set(key, []);
            activeSubscriptions.get(key).push({ dotNetHelper, methodName });

            if (dbInstance) {
                const unsub = dbInstance.collection("listings")
                    .where("status", "==", "active")
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = d.data();
                            data.id = d.id;
                            list.push(data);
                        });
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                    }, err => console.error("Listings listen error", err));
                return "sub_listings_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.listings));
            return "sub_listings_mock";
        },

        updateListingStatus: async function (listingId, newStatus) {
            if (dbInstance) {
                await dbInstance.collection("listings").doc(listingId).update({
                    status: newStatus,
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                });
                return true;
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
            if (!activeSubscriptions.has(key)) activeSubscriptions.set(key, []);
            activeSubscriptions.get(key).push({ dotNetHelper, methodName });

            if (dbInstance) {
                const unsub = dbInstance.collection("transactions")
                    .orderBy("timestamp", "desc")
                    .limit(50)
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = d.data();
                            data.paymentId = d.id;
                            list.push(data);
                        });
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                    }, err => console.error("Transactions listen error", err));
                return "sub_transactions_live";
            }

            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.transactions));
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
                    const data = d.data();
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
        }
    };
})();
