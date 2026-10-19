using System.Text.Json;
using System.Text.Json.Serialization;

namespace NUTrade.Admin.Models;

// Outcome of a callable Cloud Function invoked through NUTradeFirebase.callAppFunction.
public class FunctionResult
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("data")]
    public JsonElement? Data { get; set; }

    [JsonPropertyName("errorCode")]
    public string? ErrorCode { get; set; }

    [JsonPropertyName("errorMessage")]
    public string? ErrorMessage { get; set; }

    public static FunctionResult Failure(string message, string? code = null) =>
        new() { Success = false, ErrorMessage = message, ErrorCode = code };

    public string? GetString(params string[] names)
    {
        if (Data is not { ValueKind: JsonValueKind.Object } obj) return null;
        foreach (var name in names)
        {
            if (obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String)
            {
                var value = p.GetString();
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }
        return null;
    }

    public int? GetInt(string name) =>
        Data is { ValueKind: JsonValueKind.Object } obj
        && obj.TryGetProperty(name, out var p)
        && p.TryGetInt32(out var value)
            ? value
            : null;
}
