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
    public string PackageType { get; set; } = string.Empty; // "Free", "Standard Post" or "Priority Pin"; empty when not recorded

    [JsonPropertyName("timestamp")]
    public DateTime? Timestamp { get; set; }

    // When the PayMongo QR Ph code stops working (payments/{id}.qrExpiresAt).
    [JsonPropertyName("qrExpiresAt")]
    public DateTime? QrExpiresAt { get; set; }

    [JsonPropertyName("amount")]
    public decimal Amount { get; set; }

    // awaiting_payment, paid, failed or expired, as written by createQrPayment,
    // settleListingFee, paymongoWebhook and expireStalePayments.
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonIgnore]
    public bool IsPaid => string.Equals(Status?.Trim(), "paid", StringComparison.OrdinalIgnoreCase);

    [JsonIgnore]
    public bool HasListing => !string.IsNullOrWhiteSpace(ListingId) && ListingId != "N/A";
}
