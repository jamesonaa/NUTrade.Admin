using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

public class UserProfile
{
    [JsonPropertyName("uid")]
    public string Uid { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("displayName")]
    public string DisplayName { get; set; } = string.Empty;

    [JsonPropertyName("role")]
    public string Role { get; set; } = "student"; // "admin", "student"

    [JsonPropertyName("verificationStatus")]
    public string VerificationStatus { get; set; } = "pending"; // "pending", "verified", "rejected"

    [JsonPropertyName("photoUrl")]
    public string PhotoUrl { get; set; } = string.Empty;

    [JsonPropertyName("rejectionReason")]
    public string? RejectionReason { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("submittedAt")]
    public DateTime? SubmittedAt { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("canPost")]
    public bool CanPost { get; set; }

    [JsonPropertyName("canBid")]
    public bool CanBid { get; set; }

    [JsonPropertyName("canChat")]
    public bool CanChat { get; set; }

    [JsonPropertyName("emailVerified")]
    public bool EmailVerified { get; set; }

    public bool IsAdmin => string.Equals(Role, "admin", StringComparison.OrdinalIgnoreCase);
    public bool IsVerified => string.Equals(VerificationStatus, "verified", StringComparison.OrdinalIgnoreCase);
}
