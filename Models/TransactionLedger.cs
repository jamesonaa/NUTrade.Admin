using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

public class TransactionLedger
{
    [JsonPropertyName("paymentId")]
    public string PaymentId { get; set; } = string.Empty;

    [JsonPropertyName("payMongoIntentId")]
    public string PayMongoIntentId { get; set; } = string.Empty;

    [JsonPropertyName("userId")]
    public string UserId { get; set; } = string.Empty;

    [JsonPropertyName("userEmail")]
    public string UserEmail { get; set; } = string.Empty;

    [JsonPropertyName("listingId")]
    public string ListingId { get; set; } = string.Empty;

    [JsonPropertyName("packageType")]
    public string PackageType { get; set; } = "Additional Post"; // "Free Listing" (₱0), "Additional Post" (₱10), or "Priority Pin" (₱20)

    [JsonPropertyName("timestamp")]
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("amount")]
    public decimal Amount { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "paid"; // "paid", "refunded", "failed"
}
