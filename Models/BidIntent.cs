using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

// bidIntents/{id}: a bidder's deposit against a listing.
public class BidIntent
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("listingId")]
    public string ListingId { get; set; } = string.Empty;

    [JsonPropertyName("listingTitle")]
    public string ListingTitle { get; set; } = string.Empty;

    [JsonPropertyName("sellerUid")]
    public string SellerUid { get; set; } = string.Empty;

    [JsonPropertyName("bidderUid")]
    public string BidderUid { get; set; } = string.Empty;

    [JsonPropertyName("amountCentavos")]
    public long AmountCentavos { get; set; }

    [JsonPropertyName("depositCentavos")]
    public long DepositCentavos { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTime? CreatedAt { get; set; }

    [JsonPropertyName("resolvedAt")]
    public DateTime? ResolvedAt { get; set; }

    [JsonPropertyName("refundReason")]
    public string RefundReason { get; set; } = string.Empty;

    [JsonPropertyName("refundedVia")]
    public string RefundedVia { get; set; } = string.Empty;

    [JsonPropertyName("committedBidId")]
    public string CommittedBidId { get; set; } = string.Empty;

    [JsonIgnore]
    public decimal AmountPesos => AmountCentavos / 100m;

    [JsonIgnore]
    public decimal DepositPesos => DepositCentavos / 100m;
}
