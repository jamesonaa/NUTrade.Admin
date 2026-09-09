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

    [JsonPropertyName("timestamp")]
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}
