using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

public class BidItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("listingId")]
    public string ListingId { get; set; } = string.Empty;

    [JsonPropertyName("bidderUid")]
    public string BidderUid { get; set; } = string.Empty;

    [JsonPropertyName("bidderEmail")]
    public string BidderEmail { get; set; } = string.Empty;

    [JsonPropertyName("bidderName")]
    public string BidderName { get; set; } = string.Empty;

    [JsonPropertyName("amount")]
    public decimal Amount { get; set; }

    // Null when the bid document records no time; never defaulted to "now".
    [JsonPropertyName("timestamp")]
    public DateTime? Timestamp { get; set; }

    // Maintained by placeBid / approveBid / declineBid / withdrawBid.
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;
}

public sealed record BidLoadResult(bool Success, List<BidItem> Bids, string? Error);
