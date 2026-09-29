using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.JSInterop;
using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services
{
    // Live Firestore bridge. Wires the real onSnapshot listeners in
    // wwwroot/js/firebaseInterop.js (project nutrade-a25c7) through to the
    // Blazor pages, so the collections the mobile app writes to are what the
    // admin console displays.
    public class FirestoreService : IFirestoreService
    {
        private readonly IJSRuntime _jsRuntime;
        private DotNetObjectReference<FirestoreService>? _dotNetRef;
        private bool _subscribed;
        private bool _disposed;

        public DashboardMetrics Metrics { get; private set; } = new DashboardMetrics();
        public IReadOnlyList<UserProfile> PendingVerifications => _pendingVerifications;
        public IReadOnlyList<MarketplaceListing> ActiveListings => _activeListings;
        public IReadOnlyList<MarketplaceListing> PendingApprovalListings => _pendingApprovalListings;
        public IReadOnlyList<TransactionLedger> Transactions => _transactions;
        public IReadOnlyList<UserProfile> AllUsers => _allUsers;

        private List<UserProfile> _pendingVerifications = new();
        private List<MarketplaceListing> _activeListings = new();
        private List<MarketplaceListing> _pendingApprovalListings = new();
        private List<TransactionLedger> _transactions = new();
        private List<UserProfile> _allUsers = new();

        public event Action? OnMetricsUpdated;
        public event Action? OnVerificationsUpdated;
        public event Action? OnListingsUpdated;
        public event Action? OnPendingListingsUpdated;
        public event Action? OnTransactionsUpdated;
        public event Action? OnAllUsersUpdated;

        // Firestore documents written by the mobile app are inconsistently typed
        // (Timestamp vs ISO string vs epoch, photo arrays of strings vs maps).
        // Parse leniently so one odd document cannot hide an entire collection.
        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNameCaseInsensitive = true,
            NumberHandling = JsonNumberHandling.AllowReadingFromString,
            Converters =
            {
                new TolerantDateTimeConverter(),
                new TolerantNullableDateTimeConverter(),
                new TolerantStringListConverter()
            }
        };

        public FirestoreService(IJSRuntime jsRuntime)
        {
            _jsRuntime = jsRuntime;
        }

        public async Task InitializeSubscriptionsAsync()
        {
            // Every page calls this on init; only attach the listeners once.
            if (_subscribed) return;
            _subscribed = true;

            try
            {
                _dotNetRef ??= DotNetObjectReference.Create(this);

                await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.initFirebase");

                await _jsRuntime.InvokeAsync<string>("NUTradeFirebase.subscribeToMetrics", _dotNetRef, nameof(OnMetricsReceived));
                await _jsRuntime.InvokeAsync<string>("NUTradeFirebase.subscribeToPendingVerifications", _dotNetRef, nameof(OnVerificationsReceived));
                await _jsRuntime.InvokeAsync<string>("NUTradeFirebase.subscribeToAllUsers", _dotNetRef, nameof(OnAllUsersReceived));
                await _jsRuntime.InvokeAsync<string>("NUTradeFirebase.subscribeToPendingApprovalListings", _dotNetRef, nameof(OnPendingListingsReceived));
                await _jsRuntime.InvokeAsync<string>("NUTradeFirebase.subscribeToListings", _dotNetRef, nameof(OnListingsReceived));
                await _jsRuntime.InvokeAsync<string>("NUTradeFirebase.subscribeToTransactions", _dotNetRef, nameof(OnTransactionsReceived));
            }
            catch (Exception ex)
            {
                _subscribed = false;
                Console.WriteLine($"[FirestoreService] Subscription error: {ex.Message}");
            }
        }

        public async Task UnsubscribeAllAsync()
        {
            try
            {
                await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.unsubscribeAll");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] Unsubscribe error: {ex.Message}");
            }
            finally
            {
                _subscribed = false;
            }
        }

        // ---------------------------------------------------------------
        // JS -> .NET snapshot callbacks
        // ---------------------------------------------------------------

        [JSInvokable]
        public void OnMetricsReceived(string json)
        {
            try
            {
                var metrics = JsonSerializer.Deserialize<DashboardMetrics>(json, JsonOpts);
                if (metrics != null)
                {
                    // JS derives revenue from /payments only; fill the counts
                    // from the collections we already hold live.
                    metrics.ActiveListingsCount = _activeListings.Count;
                    metrics.PendingVerificationsCount = _pendingVerifications.Count;
                    Metrics = metrics;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] Metrics parse error: {ex.Message}");
            }

            OnMetricsUpdated?.Invoke();
        }

        [JSInvokable]
        public void OnVerificationsReceived(string json)
        {
            _pendingVerifications = ParseList<UserProfile>(json, "pendingVerifications");
            OnVerificationsUpdated?.Invoke();
            RefreshDerivedCounts();
        }

        [JSInvokable]
        public void OnAllUsersReceived(string json)
        {
            _allUsers = ParseList<UserProfile>(json, "allUsers");
            OnAllUsersUpdated?.Invoke();
        }

        [JSInvokable]
        public void OnListingsReceived(string json)
        {
            _activeListings = ParseList<MarketplaceListing>(json, "activeListings");
            OnListingsUpdated?.Invoke();
            RefreshDerivedCounts();
        }

        [JSInvokable]
        public void OnPendingListingsReceived(string json)
        {
            _pendingApprovalListings = ParseList<MarketplaceListing>(json, "pendingListings");
            OnPendingListingsUpdated?.Invoke();
        }

        [JSInvokable]
        public void OnTransactionsReceived(string json)
        {
            _transactions = ParseList<TransactionLedger>(json, "transactions");
            OnTransactionsUpdated?.Invoke();
        }

        // Raised by the JS listeners when a live query fails (typically rules, or
        // a listener attached before the auth token propagated). Clearing the
        // guard lets the next page navigation re-attach instead of staying dead.
        [JSInvokable]
        public void OnListenerError(string source, string message)
        {
            Console.WriteLine($"[FirestoreService] '{source}' listener failed: {(message ?? string.Empty).Trim()}");
            Console.WriteLine("[FirestoreService] Firestore rules must let this admin read /listings. " +
                              "Confirm users/{uid}.role == 'admin', an admins/{uid} doc, or an admin custom claim.");
            _subscribed = false;
        }

        private void RefreshDerivedCounts()
        {
            Metrics.ActiveListingsCount = _activeListings.Count;
            Metrics.PendingVerificationsCount = _pendingVerifications.Count;
            OnMetricsUpdated?.Invoke();
        }

        // ---------------------------------------------------------------
        // Moderation actions
        // ---------------------------------------------------------------

        public Task<bool> ApproveVerificationAsync(string uid) =>
            InvokeBoolAsync("NUTradeFirebase.updateVerificationStatus", uid, "verified", null);

        public Task<bool> RejectVerificationAsync(string uid, string? reason) =>
            InvokeBoolAsync("NUTradeFirebase.updateVerificationStatus", uid, "rejected", reason);

        public Task<bool> ApproveListingAsync(string listingId) =>
            InvokeBoolAsync("NUTradeFirebase.approveListing", listingId);

        public Task<bool> RejectListingAsync(string listingId, string? reason) =>
            InvokeBoolAsync("NUTradeFirebase.rejectListing", listingId, reason);

        public Task<bool> UnpublishListingAsync(string listingId) =>
            InvokeBoolAsync("NUTradeFirebase.updateListingStatus", listingId, "unpublished");

        public Task<bool> ToggleListingStatusAsync(string listingId, string newStatus) =>
            InvokeBoolAsync("NUTradeFirebase.updateListingStatus", listingId, newStatus);

        private async Task<bool> InvokeBoolAsync(string identifier, params object?[] args)
        {
            try
            {
                return await _jsRuntime.InvokeAsync<bool>(identifier, args);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] {identifier} failed: {ex.Message}");
                return false;
            }
        }

        public async Task<List<BidItem>> GetListingBidsAsync(string listingId)
        {
            try
            {
                var raw = await _jsRuntime.InvokeAsync<JsonElement>("NUTradeFirebase.getListingBids", listingId);
                if (raw.ValueKind != JsonValueKind.Array) return new List<BidItem>();

                var bids = new List<BidItem>();
                foreach (var el in raw.EnumerateArray())
                {
                    var bid = MapBid(el, listingId);
                    if (bid != null) bids.Add(bid);
                }

                return bids.OrderByDescending(b => b.Amount).ToList();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] GetListingBids failed: {ex.Message}");
                return new List<BidItem>();
            }
        }

        // Bid documents from the app store money in centavos (amountCentavos)
        // and time as createdAt; BidItem expects pesos and timestamp.
        private static BidItem? MapBid(JsonElement el, string listingId)
        {
            if (el.ValueKind != JsonValueKind.Object) return null;

            try
            {
                var bid = el.Deserialize<BidItem>(JsonOpts) ?? new BidItem();

                if (string.IsNullOrEmpty(bid.ListingId)) bid.ListingId = listingId;

                if (bid.Amount == 0)
                {
                    var centavos = FirstNumber(el, "amountCentavos", "bidAmountCentavos", "amountInCentavos");
                    if (centavos.HasValue) bid.Amount = centavos.Value / 100m;
                    else
                    {
                        var pesos = FirstNumber(el, "bidAmount", "value", "price");
                        if (pesos.HasValue) bid.Amount = pesos.Value;
                    }
                }

                if (bid.Timestamp == default)
                {
                    var ts = FirstDateTime(el, "createdAt", "placedAt", "bidAt", "updatedAt");
                    if (ts.HasValue) bid.Timestamp = ts.Value;
                }

                if (string.IsNullOrEmpty(bid.BidderUid))
                    bid.BidderUid = FirstString(el, "bidderUid", "userId", "uid", "bidderId") ?? string.Empty;

                if (string.IsNullOrEmpty(bid.BidderName))
                    bid.BidderName = FirstString(el, "bidderName", "displayName", "userName", "name") ?? string.Empty;

                if (string.IsNullOrEmpty(bid.BidderEmail))
                    bid.BidderEmail = FirstString(el, "bidderEmail", "userEmail", "email") ?? string.Empty;

                return bid;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] Skipped malformed bid: {ex.Message}");
                return null;
            }
        }

        private static decimal? FirstNumber(JsonElement el, params string[] names)
        {
            foreach (var n in names)
            {
                if (!el.TryGetProperty(n, out var p)) continue;
                if (p.ValueKind == JsonValueKind.Number && p.TryGetDecimal(out var d)) return d;
                if (p.ValueKind == JsonValueKind.String &&
                    decimal.TryParse(p.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var s)) return s;
            }
            return null;
        }

        private static string? FirstString(JsonElement el, params string[] names)
        {
            foreach (var n in names)
            {
                if (el.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.String)
                {
                    var v = p.GetString();
                    if (!string.IsNullOrWhiteSpace(v)) return v;
                }
            }
            return null;
        }

        private static DateTime? FirstDateTime(JsonElement el, params string[] names)
        {
            foreach (var n in names)
            {
                if (!el.TryGetProperty(n, out var p)) continue;
                if (p.ValueKind == JsonValueKind.String &&
                    DateTime.TryParse(p.GetString(), CultureInfo.InvariantCulture,
                        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var dt)) return dt;
            }
            return null;
        }

        // Batch-parse a snapshot; on failure fall back to per-document parsing
        // so a single bad document does not blank out the whole page.
        private static List<T> ParseList<T>(string json, string label)
        {
            if (string.IsNullOrWhiteSpace(json)) return new List<T>();

            try
            {
                return JsonSerializer.Deserialize<List<T>>(json, JsonOpts) ?? new List<T>();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] {label}: batch parse failed ({ex.Message}); retrying per document.");
            }

            var result = new List<T>();
            try
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) return result;

                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    try
                    {
                        var item = el.Deserialize<T>(JsonOpts);
                        if (item != null) result.Add(item);
                    }
                    catch (Exception itemEx)
                    {
                        Console.WriteLine($"[FirestoreService] {label}: skipped document -> {itemEx.Message}");
                    }
                }
            }
            catch (Exception docEx)
            {
                Console.WriteLine($"[FirestoreService] {label}: invalid payload -> {docEx.Message}");
            }

            return result;
        }

        // ---------------------------------------------------------------
        // Lenient converters
        // ---------------------------------------------------------------

        private static DateTime? ReadDate(ref Utf8JsonReader reader)
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.Null:
                    return null;

                case JsonTokenType.String:
                    var s = reader.GetString();
                    if (string.IsNullOrWhiteSpace(s)) return null;
                    return DateTime.TryParse(s, CultureInfo.InvariantCulture,
                        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var dt)
                        ? dt
                        : null;

                case JsonTokenType.Number:
                    if (reader.TryGetInt64(out var n))
                    {
                        // Heuristic: epoch milliseconds vs seconds.
                        return n > 99_999_999_999L
                            ? DateTimeOffset.FromUnixTimeMilliseconds(n).UtcDateTime
                            : DateTimeOffset.FromUnixTimeSeconds(n).UtcDateTime;
                    }
                    return null;

                case JsonTokenType.StartObject:
                    // Unconverted Firestore Timestamp: { seconds, nanoseconds }
                    long? seconds = null;
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                    {
                        if (reader.TokenType != JsonTokenType.PropertyName) continue;
                        var prop = reader.GetString();
                        reader.Read();
                        if ((prop == "seconds" || prop == "_seconds") && reader.TryGetInt64(out var sec))
                            seconds = sec;
                    }
                    return seconds.HasValue ? DateTimeOffset.FromUnixTimeSeconds(seconds.Value).UtcDateTime : null;

                default:
                    reader.Skip();
                    return null;
            }
        }

        private sealed class TolerantNullableDateTimeConverter : JsonConverter<DateTime?>
        {
            public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
                => ReadDate(ref reader);

            public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
            {
                if (value.HasValue) writer.WriteStringValue(value.Value.ToString("o", CultureInfo.InvariantCulture));
                else writer.WriteNullValue();
            }
        }

        private sealed class TolerantDateTimeConverter : JsonConverter<DateTime>
        {
            public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
                => ReadDate(ref reader) ?? default;

            public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
                => writer.WriteStringValue(value.ToString("o", CultureInfo.InvariantCulture));
        }

        // Photo arrays arrive as string URLs, or as maps like { url: "..." }.
        private sealed class TolerantStringListConverter : JsonConverter<List<string>>
        {
            public override List<string>? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            {
                if (reader.TokenType == JsonTokenType.Null) return null;

                if (reader.TokenType == JsonTokenType.String)
                {
                    var single = reader.GetString();
                    return string.IsNullOrWhiteSpace(single) ? new List<string>() : new List<string> { single };
                }

                if (reader.TokenType != JsonTokenType.StartArray)
                {
                    reader.Skip();
                    return new List<string>();
                }

                var list = new List<string>();
                while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                {
                    if (reader.TokenType == JsonTokenType.String)
                    {
                        var v = reader.GetString();
                        if (!string.IsNullOrWhiteSpace(v)) list.Add(v);
                    }
                    else if (reader.TokenType == JsonTokenType.StartObject)
                    {
                        using var obj = JsonDocument.ParseValue(ref reader);
                        foreach (var key in new[] { "url", "downloadUrl", "downloadURL", "src", "path", "imageUrl" })
                        {
                            if (obj.RootElement.TryGetProperty(key, out var p) && p.ValueKind == JsonValueKind.String)
                            {
                                var v = p.GetString();
                                if (!string.IsNullOrWhiteSpace(v)) { list.Add(v); break; }
                            }
                        }
                    }
                    else
                    {
                        reader.Skip();
                    }
                }

                return list;
            }

            public override void Write(Utf8JsonWriter writer, List<string> value, JsonSerializerOptions options)
            {
                writer.WriteStartArray();
                foreach (var v in value) writer.WriteStringValue(v);
                writer.WriteEndArray();
            }
        }

        // ---------------------------------------------------------------

        public async ValueTask DisposeAsync()
        {
            await DisposeAsyncCore();
            Dispose(false);
            GC.SuppressFinalize(this);
        }

        protected virtual async ValueTask DisposeAsyncCore()
        {
            if (_subscribed)
            {
                try { await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.unsubscribeAll"); }
                catch (Exception ex) { Console.WriteLine($"[FirestoreService] Dispose unsubscribe warning: {ex.Message}"); }
                _subscribed = false;
            }

            _dotNetRef?.Dispose();
            _dotNetRef = null;
        }

        protected virtual void Dispose(bool disposing)
        {
            if (_disposed) return;
            if (disposing)
            {
                _dotNetRef?.Dispose();
                _dotNetRef = null;
            }
            _disposed = true;
        }
    }
}
