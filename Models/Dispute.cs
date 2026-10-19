using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

// disputes/{id}. Status: open, resolved. Resolution: forfeit, refund.
public class Dispute
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("chatId")]
    public string ChatId { get; set; } = string.Empty;

    [JsonPropertyName("listingId")]
    public string ListingId { get; set; } = string.Empty;

    [JsonPropertyName("listingTitle")]
    public string ListingTitle { get; set; } = string.Empty;

    [JsonPropertyName("sellerUid")]
    public string SellerUid { get; set; } = string.Empty;

    [JsonPropertyName("buyerUid")]
    public string BuyerUid { get; set; } = string.Empty;

    [JsonPropertyName("depositIntentId")]
    public string DepositIntentId { get; set; } = string.Empty;

    [JsonPropertyName("depositCentavos")]
    public long DepositCentavos { get; set; }

    [JsonPropertyName("note")]
    public string Note { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTime? CreatedAt { get; set; }

    [JsonPropertyName("resolvedAt")]
    public DateTime? ResolvedAt { get; set; }

    [JsonPropertyName("resolvedBy")]
    public string ResolvedBy { get; set; } = string.Empty;

    [JsonPropertyName("resolution")]
    public string Resolution { get; set; } = string.Empty;

    [JsonIgnore]
    public decimal DepositPesos => DepositCentavos / 100m;
}
