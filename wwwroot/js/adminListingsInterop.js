/* Admin-only Firestore listings bridge. Uses the existing Firebase app/project. */
(function () {
    const listeners = new Map();
    let nextListenerId = 1;

    function db() {
        if (!window.firebase || !firebase.apps || !firebase.apps.length) {
            throw new Error("Firebase has not been initialized.");
        }
        return firebase.firestore();
    }

    function numberOrZero(value) {
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    }

    function dateValue(value) {
        if (!value) return null;
        if (typeof value.toDate === "function") return value.toDate().toISOString();
        if (value instanceof Date) return value.toISOString();
        return value;
    }

    async function mapListing(doc) {
        const d = doc.data() || {};
        const ownerUid = d.ownerUid || d.sellerUid || d.userId || "";
        let sellerName = d.sellerName || d.ownerName || "";
        let sellerEmail = d.sellerEmail || d.ownerEmail || "";

        if (ownerUid) {
            try {
                const user = await db().collection("users").doc(ownerUid).get();
                if (user.exists) {
                    const u = user.data() || {};
                    sellerName = sellerName || u.displayName || [u.firstName, u.lastName].filter(Boolean).join(" ");
                    sellerEmail = sellerEmail || u.email || "";
                }
            } catch (error) {
                // Listing data should still be displayed if a user profile cannot be read.
                console.warn("Unable to load seller profile", ownerUid, error);
            }
        }

        const startingCentavos = numberOrZero(d.startingBidCentavos || d.startingPriceCentavos);
        const highestCentavos = numberOrZero(d.currentHighestBidCentavos || d.highestBidCentavos);
        const reserveCentavos = numberOrZero(d.reservePriceCentavos);
        const photos = Array.isArray(d.photos) ? d.photos : (d.imageUrl ? [d.imageUrl] : []);

        return {
            id: doc.id,
            title: d.title || "",
            description: d.description || "",
            category: d.category || d.categoryOther || "General",
            sellerUid: ownerUid,
            sellerName,
            sellerEmail,
            currentHighestBid: highestCentavos / 100,
            reservePrice: reserveCentavos / 100,
            startingPrice: startingCentavos / 100,
            status: d.status || "draft",
            paidPackage: d.paidPackage || d.package || "Free",
            paymentStatus: d.paymentStatus || "free",
            paymentId: d.paymentId || "",
            payMongoIntentId: d.payMongoIntentId || "",
            auctionEndsAt: dateValue(d.auctionEndsAt),
            publishedAt: dateValue(d.publishedAt),
            approvedAt: dateValue(d.approvedAt),
            approvedBy: d.approvedBy || "",
            rejectedAt: dateValue(d.rejectedAt),
            rejectedBy: d.rejectedBy || "",
            rejectionReason: d.rejectionReason || "",
            isPinned: !!d.isPinned,
            photos,
            imageUrl: photos.length ? photos[0] : "",
            totalBids: numberOrZero(d.bidCount || d.totalBids),
            createdAt: dateValue(d.createdAt || d.submittedForApprovalAt),
            campusZone: d.campusZone || "",
            condition: d.condition || "",
            isVisible: d.isVisible !== false
        };
    }

    window.adminListingsInterop = {
        start: function (dotNetRef) {
            const id = nextListenerId++;
            const unsubscribe = db().collection("listings").onSnapshot(async snapshot => {
                try {
                    const listings = await Promise.all(snapshot.docs.map(mapListing));
                    await dotNetRef.invokeMethodAsync("ReceiveListings", JSON.stringify(listings));
                } catch (error) {
                    console.error("Unable to map Firestore listings", error);
                    await dotNetRef.invokeMethodAsync("ReceiveListingsError", String(error));
                }
            }, async error => {
                console.error("Unable to subscribe to Firestore listings", error);
                await dotNetRef.invokeMethodAsync("ReceiveListingsError", String(error));
            });
            listeners.set(id, unsubscribe);
            return id;
        },

        stop: function (id) {
            const unsubscribe = listeners.get(id);
            if (unsubscribe) unsubscribe();
            listeners.delete(id);
        },

        updateStatus: async function (listingId, status, extra) {
            const update = Object.assign({ status: status }, extra || {});
            await db().collection("listings").doc(listingId).update(update);
            return true;
        },

        getBids: async function (listingId) {
            const snapshot = await db().collection("listings").doc(listingId).collection("bids").get();
            return JSON.stringify(snapshot.docs.map(doc => {
                const d = doc.data() || {};
                return {
                    id: doc.id,
                    listingId,
                    bidderUid: d.bidderUid || d.userId || "",
                    bidderEmail: d.bidderEmail || "",
                    bidderName: d.bidderName || "",
                    amount: numberOrZero(d.amountCentavos || d.amount) / (d.amountCentavos ? 100 : 1),
                    timestamp: dateValue(d.timestamp) || new Date().toISOString()
                };
            }));
        }
    };
})();
