using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public interface IFirestoreService : IAsyncDisposable
{
    DashboardMetrics Metrics { get; }
    IReadOnlyList<UserProfile> PendingVerifications { get; }
    IReadOnlyList<MarketplaceListing> ActiveListings { get; }
    IReadOnlyList<TransactionLedger> Transactions { get; }

    event Action? OnMetricsUpdated;
    event Action? OnVerificationsUpdated;
    event Action? OnListingsUpdated;
    event Action? OnTransactionsUpdated;

    Task InitializeSubscriptionsAsync();
    Task<bool> ApproveVerificationAsync(string uid);
    Task<bool> RejectVerificationAsync(string uid, string? reason);
    Task<bool> UnpublishListingAsync(string listingId);
    Task<bool> ToggleListingStatusAsync(string listingId, string newStatus);
    Task<List<BidItem>> GetListingBidsAsync(string listingId);
}
