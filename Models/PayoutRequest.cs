using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

// payoutRequests/{id}. Status: requested, paid, declined.
public class PayoutRequest
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("uid")]
    public string Uid { get; set; } = string.Empty;

    [JsonPropertyName("amountCentavos")]
    public long AmountCentavos { get; set; }

    [JsonPropertyName("method")]
    public string Method { get; set; } = string.Empty;

    [JsonPropertyName("accountName")]
    public string AccountName { get; set; } = string.Empty;

    [JsonPropertyName("accountNumber")]
    public string AccountNumber { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTime? CreatedAt { get; set; }

    [JsonPropertyName("resolvedAt")]
    public DateTime? ResolvedAt { get; set; }

    [JsonPropertyName("resolvedBy")]
    public string ResolvedBy { get; set; } = string.Empty;

    [JsonPropertyName("declineReason")]
    public string DeclineReason { get; set; } = string.Empty;

    [JsonIgnore]
    public decimal AmountPesos => AmountCentavos / 100m;
}
