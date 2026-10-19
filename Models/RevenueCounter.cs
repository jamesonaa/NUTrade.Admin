using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

// counters/revenue, maintained by the app's payment and deposit functions.
public class RevenueCounter
{
    [JsonPropertyName("exists")]
    public bool Exists { get; set; }

    [JsonPropertyName("grossCentavos")]
    public long GrossCentavos { get; set; }

    [JsonPropertyName("transactionCount")]
    public long TransactionCount { get; set; }

    [JsonPropertyName("forfeitedDepositsCentavos")]
    public long ForfeitedDepositsCentavos { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTime? UpdatedAt { get; set; }

    [JsonIgnore]
    public decimal GrossPesos => GrossCentavos / 100m;

    [JsonIgnore]
    public decimal ForfeitedDepositsPesos => ForfeitedDepositsCentavos / 100m;
}
