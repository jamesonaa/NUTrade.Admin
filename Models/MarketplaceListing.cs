using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

public class MarketplaceListing
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string Category { get; set; } = "General";

    [JsonPropertyName("sellerUid")]
    public string SellerUid { get; set; } = string.Empty;

    [JsonPropertyName("sellerName")]
    public string SellerName { get; set; } = string.Empty;

    [JsonPropertyName("sellerEmail")]
    public string SellerEmail { get; set; } = string.Empty;

    [JsonPropertyName("currentHighestBid")]
    public decimal CurrentHighestBid { get; set; }

    [JsonPropertyName("reservePrice")]
    public decimal ReservePrice { get; set; }

    [JsonPropertyName("startingPrice")]
    public decimal StartingPrice { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "active"; // "draft", "pending_payment", "pending_approval", "active", "rejected", "unpublished", "sold", "expired"

    [JsonPropertyName("paidPackage")]
    public string PaidPackage { get; set; } = "Free"; // "Free", "Standard Post", "Priority Pin"

    [JsonPropertyName("auctionEndsAt")]
    public DateTime? AuctionEndsAt { get; set; }

    [JsonPropertyName("publishedAt")]
    public DateTime? PublishedAt { get; set; }

    [JsonPropertyName("approvedAt")]
    public DateTime? ApprovedAt { get; set; }

    [JsonPropertyName("approvedBy")]
    public string ApprovedBy { get; set; } = string.Empty;

    [JsonPropertyName("rejectedAt")]
    public DateTime? RejectedAt { get; set; }

    [JsonPropertyName("rejectedBy")]
    public string RejectedBy { get; set; } = string.Empty;

    [JsonPropertyName("rejectionReason")]
    public string RejectionReason { get; set; } = string.Empty;

    [JsonPropertyName("isPinned")]
    public bool IsPinned { get; set; }

    [JsonPropertyName("photos")]
    public List<string>? Photos { get; set; }

    [JsonPropertyName("imageUrl")]
    public string? LegacyImageUrl { get; set; }

    [JsonIgnore]
    public string ImageUrl => Photos != null && Photos.Any() ? Photos.First() : (LegacyImageUrl ?? string.Empty);

    [JsonPropertyName("totalBids")]
    public int TotalBids { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTime? CreatedAt { get; set; }

    public TimeSpan RemainingTime => AuctionEndsAt.HasValue && AuctionEndsAt.Value > DateTime.UtcNow
        ? AuctionEndsAt.Value - DateTime.UtcNow
        : TimeSpan.Zero;
    public bool IsExpired => AuctionEndsAt.HasValue && AuctionEndsAt.Value <= DateTime.UtcNow;
}
