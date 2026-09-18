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
                    console.log("NUTrade: Firebase SDK initialized successfully for project nutrade-a25c7.");
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
            // Check real Firebase Auth if loaded and configured
            if (authInstance) {
                try {
                    const cred = await authInstance.signInWithEmailAndPassword(email, password);
                    const uid = cred.user.uid;
                    const token = await cred.user.getIdToken();

                    // Query users/{uid} for role check
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

                    // Check Firebase Auth emailVerified status
                    if (!cred.user.emailVerified) {
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
                    }

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
                        errorMessage: err.message || "Firebase Authentication failed."
                    };
                }
            }

            return {
                success: false,
                errorMessage: "Firebase Authentication is not initialized or offline."
            };
        },

        saveSecurityCodeHash: async function (uid, codeHash, expiresAtIso) {
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
                    console.warn("NUTrade: Firestore saveSecurityCodeHash error:", err);
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
            if (dbInstance) {
                try {
                    const doc = await dbInstance.collection("admin_security_codes").doc(uid).get();
                    if (doc.exists) {
                        return doc.data();
                    }
                } catch (err) {
                    console.warn("NUTrade: Firestore getSecurityCodeHash error:", err);
                }
            }
            return mockState.securityCodes[uid] || null;
        },

        deleteSecurityCodeHash: async function (uid) {
            if (dbInstance) {
                try {
                    await dbInstance.collection("admin_security_codes").doc(uid).delete();
                } catch (err) { }
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
                const unsub = dbInstance.collection("system").doc("metrics")
                    .onSnapshot(doc => {
                        if (doc.exists) {
                            const data = sanitizeFirestoreData(doc.data());
                            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(data));
                        } else {
                            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.metrics));
                        }
                    }, err => {
                        console.warn("Metrics Firestore permission/read fallback:", err.message);
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.metrics));
                    });
                storeLiveUnsubscriber(key, unsub);
                return "sub_metrics_live";
            }

            // Immediately send current metrics
            dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.metrics));
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
                    .orderBy("createdAt", "desc")
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = sanitizeFirestoreData(d.data());
                            data.uid = d.id;
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

        // 4. Listing Moderation & Realtime Active Listings
        subscribeToListings: function (dotNetHelper, methodName) {
            const key = "listings";
            registerCallback(key, dotNetHelper, methodName);

            if (dbInstance) {
                const unsub = dbInstance.collection("listings")
                    .where("status", "==", "active")
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = sanitizeFirestoreData(d.data());
                            data.id = d.id;
                            list.push(data);
                        });
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                    }, err => {
                        console.warn("Listings Firestore permission/read fallback:", err.message);
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.listings));
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
                    await dbInstance.collection("listings").doc(listingId).update({
                        status: newStatus,
                        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                    });
                    return true;
                } catch (writeErr) {
                    console.warn("Firestore update listing status fallback:", writeErr.message);
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
                const unsub = dbInstance.collection("transactions")
                    .orderBy("timestamp", "desc")
                    .limit(50)
                    .onSnapshot(snap => {
                        const list = [];
                        snap.forEach(d => {
                            const data = sanitizeFirestoreData(d.data());
                            data.paymentId = d.id;
                            list.push(data);
                        });
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(list));
                    }, err => {
                        console.warn("Transactions Firestore permission/read fallback:", err.message);
                        dotNetHelper.invokeMethodAsync(methodName, JSON.stringify(mockState.transactions));
                    });
                storeLiveUnsubscriber(key, unsub);
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
        }
    };
})();
