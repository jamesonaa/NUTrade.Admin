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

    [JsonPropertyName("firstName")]
    public string FirstName { get; set; } = string.Empty;

    [JsonPropertyName("lastName")]
    public string LastName { get; set; } = string.Empty;

    [JsonPropertyName("program")]
    public string Program { get; set; } = string.Empty;

    // users/{uid}.program without display fallbacks; used for the program breakdown.
    [JsonPropertyName("programRaw")]
    public string ProgramRaw { get; set; } = string.Empty;

    [JsonPropertyName("role")]
    public string Role { get; set; } = "student"; // "admin", "student"

    // Empty when the profile document does not carry the field; see EffectiveVerificationStatus.
    [JsonPropertyName("verificationStatus")]
    public string VerificationStatus { get; set; } = string.Empty; // "pending", "verified", "rejected"

    [JsonPropertyName("verified")]
    [JsonConverter(typeof(LenientNullableBoolConverter))]
    public bool? Verified { get; set; }

    [JsonPropertyName("photoUrl")]
    public string PhotoUrl { get; set; } = string.Empty;

    [JsonPropertyName("rejectionReason")]
    public string? RejectionReason { get; set; }

    // Written by the setUserVerification Cloud Function.
    [JsonPropertyName("verificationReason")]
    public string? VerificationReason { get; set; }

    [JsonPropertyName("verifiedAt")]
    public DateTime? VerifiedAt { get; set; }

    [JsonPropertyName("reviewedBy")]
    public string? ReviewedBy { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTime? CreatedAt { get; set; }

    [JsonPropertyName("submittedAt")]
    public DateTime? SubmittedAt { get; set; }

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

    // The `verified` custom claim itself is not readable from the browser, so this
    // reflects what the student's profile document records.
    [JsonIgnore]
    public string EffectiveVerificationStatus
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(VerificationStatus)) return VerificationStatus.Trim().ToLowerInvariant();
            if (Verified == true || EmailVerified) return "verified";
            if (Verified == false) return "unverified";
            return string.Empty;
        }
    }

    [JsonIgnore]
    public bool IsEffectivelyVerified => EffectiveVerificationStatus == "verified";

    public string FormattedProgram
    {
        get
        {
            if (string.IsNullOrWhiteSpace(Program) || string.Equals(Program, "Program unavailable", StringComparison.OrdinalIgnoreCase))
                return "Program not provided";

            if (Program.StartsWith("School of", StringComparison.OrdinalIgnoreCase))
                return Program;

            return $"School of {Program}";
        }
    }
}

// Reads true/false, "true"/"false" and 1/0; anything else becomes null instead of
// failing the whole document.
public sealed class LenientNullableBoolConverter : JsonConverter<bool?>
{
    public override bool? Read(ref System.Text.Json.Utf8JsonReader reader, Type typeToConvert, System.Text.Json.JsonSerializerOptions options)
    {
        switch (reader.TokenType)
        {
            case System.Text.Json.JsonTokenType.True: return true;
            case System.Text.Json.JsonTokenType.False: return false;
            case System.Text.Json.JsonTokenType.String:
                return bool.TryParse(reader.GetString(), out var b) ? b : null;
            case System.Text.Json.JsonTokenType.Number:
                return reader.TryGetInt64(out var n) ? n != 0 : null;
            default:
                reader.Skip();
                return null;
        }
    }

    public override void Write(System.Text.Json.Utf8JsonWriter writer, bool? value, System.Text.Json.JsonSerializerOptions options)
    {
        if (value.HasValue) writer.WriteBooleanValue(value.Value);
        else writer.WriteNullValue();
    }
}
