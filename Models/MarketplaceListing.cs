using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

public class MarketplaceListing
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

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
    public string Status { get; set; } = "active"; // "active", "unpublished", "sold", "expired"

    [JsonPropertyName("auctionEndsAt")]
    public DateTime AuctionEndsAt { get; set; } = DateTime.UtcNow.AddHours(24);

    [JsonPropertyName("isPinned")]
    public bool IsPinned { get; set; }

    [JsonPropertyName("imageUrl")]
    public string ImageUrl { get; set; } = string.Empty;

    [JsonPropertyName("totalBids")]
    public int TotalBids { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public TimeSpan RemainingTime => AuctionEndsAt > DateTime.UtcNow ? AuctionEndsAt - DateTime.UtcNow : TimeSpan.Zero;
    public bool IsExpired => AuctionEndsAt <= DateTime.UtcNow;
}
