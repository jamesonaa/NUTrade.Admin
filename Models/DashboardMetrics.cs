using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

// Every value is derived from live Firestore data; defaults are zero until the
// first snapshot arrives.
public class DashboardMetrics
{
    // Sum of /payments records whose status is paid.
    [JsonPropertyName("grossRevenue")]
    public decimal GrossRevenue { get; set; }

    [JsonPropertyName("totalTransactionsCount")]
    public int TotalTransactionsCount { get; set; }

    // Sum of each listing's bidCount.
    [JsonPropertyName("totalBidsPlaced")]
    public int TotalBidsPlaced { get; set; }

    // Ended auctions that closed with at least one bid, as a percentage.
    [JsonPropertyName("auctionCompletionRate")]
    public double AuctionCompletionRate { get; set; }

    [JsonPropertyName("averageBidsPerItem")]
    public double AverageBidsPerItem { get; set; }

    // Submitted (non-draft) listings whose fee was paid, as a percentage.
    [JsonPropertyName("freeToPaidConversionRate")]
    public double FreeToPaidConversionRate { get; set; }

    [JsonPropertyName("activeListingsCount")]
    public int ActiveListingsCount { get; set; }

    [JsonPropertyName("pendingVerificationsCount")]
    public int PendingVerificationsCount { get; set; }

    public int TotalListingsCount { get; set; }
    public int AuctionedListingsCount { get; set; }
    public int EndedAuctionsCount { get; set; }
    public int SubmittedListingsCount { get; set; }

    [JsonPropertyName("lastUpdated")]
    public DateTime? LastUpdated { get; set; }
}
