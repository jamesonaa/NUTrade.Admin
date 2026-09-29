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

    [JsonPropertyName("paymentStatus")]
    public string PaymentStatus { get; set; } = "free"; // "paid", "free", "unpaid", "pending_payment"

    [JsonPropertyName("paymentId")]
    public string PaymentId { get; set; } = string.Empty;

    [JsonPropertyName("payMongoIntentId")]
    public string PayMongoIntentId { get; set; } = string.Empty;

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

    // Written by paymongoWebhook (functions/index.js) on verified payment.
    [JsonPropertyName("paidAt")]
    public DateTime? PaidAt { get; set; }

    [JsonPropertyName("totalBids")]
    public int TotalBids { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTime? CreatedAt { get; set; }

    public TimeSpan RemainingTime => AuctionEndsAt.HasValue && AuctionEndsAt.Value > DateTime.UtcNow
        ? AuctionEndsAt.Value - DateTime.UtcNow
        : TimeSpan.Zero;
    public bool IsExpired => AuctionEndsAt.HasValue && AuctionEndsAt.Value <= DateTime.UtcNow;

    // ------------------------------------------------------------------
    // Payment gate.
    //
    // Source of truth is the listing document itself. paymongoWebhook
    // (functions/index.js) writes paymentStatus:'paid' + paidAt and moves the
    // listing pending_payment -> pending_approval only after PayMongo confirms.
    // A paid record in /payments (joined on listingId by firebaseInterop.js)
    // is also accepted. Nothing here infers "paid" from a package name or an
    // amount - an unverified listing stays Unpaid.
    // ------------------------------------------------------------------

    private static readonly string[] PaidStates =
        { "paid", "succeeded", "success", "completed", "complete", "settled", "captured" };

    private static readonly string[] PaidPackageNames =
        { "priority pin", "standard post", "additional post" };

    // Statuses that can never be approved from the queue. Anything else in the
    // pending queue is treated as approvable, so an unexpected status name from
    // the app does not lock the admin out.
    private static readonly string[] NonApprovableStates =
        { "draft", "pending_payment", "active", "rejected", "unpublished", "deleted",
          "sold", "expired", "pending_meetup", "completed" };

    private string NormalizedStatus => (Status ?? string.Empty).Trim().ToLowerInvariant();
    private string NormalizedPaymentStatus => (PaymentStatus ?? string.Empty).Trim().ToLowerInvariant();
    private string NormalizedPackage => (PaidPackage ?? string.Empty).Trim().ToLowerInvariant();

    [JsonIgnore]
    public bool IsPaid =>
        PaidStates.Contains(NormalizedPaymentStatus) || PaidAt.HasValue;

    // A payment is owed when the listing sits in pending_payment, or it carries a
    // chargeable package, or its own paymentStatus says a charge is outstanding.
    [JsonIgnore]
    public bool RequiresPayment =>
        NormalizedStatus == "pending_payment"
        || PaidPackageNames.Contains(NormalizedPackage)
        || NormalizedPaymentStatus is "unpaid" or "pending" or "pending_payment" or "awaiting_payment" or "failed" or "expired";

    [JsonIgnore]
    public bool PaymentRequirementSatisfied => IsPaid || !RequiresPayment;

    // "Paid" / "Unpaid" / "Free" - what the admin table shows.
    [JsonIgnore]
    public string PaymentLabel =>
        IsPaid ? "Paid" : (RequiresPayment ? "Unpaid" : "Free");

    [JsonIgnore]
    public bool IsApprovableStatus => !NonApprovableStates.Contains(NormalizedStatus);

    [JsonIgnore]
    public bool CanApprove => IsApprovableStatus && PaymentRequirementSatisfied;

    [JsonIgnore]
    public string ApproveBlockedReason =>
        CanApprove ? string.Empty
        : !PaymentRequirementSatisfied
            ? $"Payment is Unpaid ({(string.IsNullOrWhiteSpace(PaymentStatus) ? "no payment record" : PaymentStatus)}). Approval is blocked until PayMongo confirms the fee."
            : NormalizedStatus == "draft"
                ? "This listing is still a draft in the mobile app and has not been submitted for approval."
                : $"Status '{Status}' cannot be approved.";
}
