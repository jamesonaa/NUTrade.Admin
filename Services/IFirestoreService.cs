using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public interface IFirestoreService : IAsyncDisposable
{
    DashboardMetrics Metrics { get; }
    IReadOnlyList<UserProfile> PendingVerifications { get; }
    IReadOnlyList<MarketplaceListing> ActiveListings { get; }
    IReadOnlyList<MarketplaceListing> PendingApprovalListings { get; }
    IReadOnlyList<MarketplaceListing> AllListings { get; }
    IReadOnlyList<TransactionLedger> Transactions { get; }
    IReadOnlyList<UserProfile> AllUsers { get; }

    // True once the first snapshot (or a listener error) has arrived.
    bool ListingsLoaded { get; }
    bool UsersLoaded { get; }
    bool TransactionsLoaded { get; }

    // Most recent listener failure, cleared when that listener delivers data again.
    string? LastListenerError { get; }

    event Action? OnMetricsUpdated;
    event Action? OnVerificationsUpdated;
    event Action? OnListingsUpdated;
    event Action? OnPendingListingsUpdated;
    event Action? OnAllListingsUpdated;
    event Action? OnTransactionsUpdated;
    event Action? OnAllUsersUpdated;

    Task InitializeSubscriptionsAsync();
    Task UnsubscribeAllAsync();
    Task<FunctionResult> ApproveListingAsync(string listingId);
    Task<FunctionResult> RejectListingAsync(string listingId, string? reason);
    Task<List<BidItem>> GetListingBidsAsync(string listingId);
    Task<BidLoadResult> TryGetListingBidsAsync(string listingId);

    // Admin-only callable: revokes (verified = false) or restores the student's `verified` claim.
    Task<FunctionResult> SetUserVerificationAsync(string uid, bool verified, string? reason = null);

    Task<FunctionResult> CallFunctionAsync(string name, object? payload, bool forceTokenRefresh = false);

    // Revenue Desk: listeners are attached only while the Revenue Desk page is open.
    RevenueCounter RevenueCounter { get; }
    IReadOnlyList<TransactionLedger> ListingFeeTransactions { get; }
    IReadOnlyList<BidIntent> ForfeitedDeposits { get; }
    IReadOnlyList<PayoutRequest> PayoutQueue { get; }
    IReadOnlyList<Dispute> DisputeQueue { get; }
    bool RevenueCounterLoaded { get; }
    bool ListingFeeTransactionsLoaded { get; }
    bool ForfeitedDepositsLoaded { get; }
    bool PayoutQueueLoaded { get; }
    bool DisputeQueueLoaded { get; }
    IReadOnlyDictionary<string, string> RevenueDeskErrors { get; }
    event Action? OnRevenueDeskUpdated;
    Task SubscribeRevenueDeskAsync();
    Task UnsubscribeRevenueDeskAsync();
    Task<FunctionResult> MarkPayoutPaidAsync(string payoutRequestId);
    Task<FunctionResult> DeclinePayoutAsync(string payoutRequestId, string? reason);
    Task<FunctionResult> ResolveDisputeAsync(string disputeId, string resolution);
}
