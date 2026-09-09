using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

public class DashboardMetrics
{
    [JsonPropertyName("grossRevenue")]
    public decimal GrossRevenue { get; set; } = 48500.00m;

    [JsonPropertyName("totalBidsPlaced")]
    public int TotalBidsPlaced { get; set; } = 1428;

    [JsonPropertyName("auctionCompletionRate")]
    public double AuctionCompletionRate { get; set; } = 84.6; // percentage matched vs expired

    [JsonPropertyName("averageBidsPerItem")]
    public double AverageBidsPerItem { get; set; } = 6.4;

    [JsonPropertyName("freeToPaidConversionRate")]
    public double FreeToPaidConversionRate { get; set; } = 38.2; // percentage

    [JsonPropertyName("activeListingsCount")]
    public int ActiveListingsCount { get; set; } = 74;

    [JsonPropertyName("pendingVerificationsCount")]
    public int PendingVerificationsCount { get; set; } = 12;

    [JsonPropertyName("totalTransactionsCount")]
    public int TotalTransactionsCount { get; set; } = 2890;

    [JsonPropertyName("lastUpdated")]
    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;
}
