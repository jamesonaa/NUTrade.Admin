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
        public IReadOnlyList<MarketplaceListing> AllListings => _allListings;
        public IReadOnlyList<TransactionLedger> Transactions => _transactions;
        public IReadOnlyList<UserProfile> AllUsers => _allUsers;

        public bool ListingsLoaded { get; private set; }
        public bool UsersLoaded { get; private set; }
        public bool TransactionsLoaded { get; private set; }
        public string? LastListenerError { get; private set; }
        private string? _lastErrorSource;

        private List<UserProfile> _pendingVerifications = new();
        private List<MarketplaceListing> _activeListings = new();
        private List<MarketplaceListing> _pendingApprovalListings = new();
        private List<MarketplaceListing> _allListings = new();
        private List<TransactionLedger> _transactions = new();
        private List<UserProfile> _allUsers = new();

        public event Action? OnMetricsUpdated;
        public event Action? OnVerificationsUpdated;
        public event Action? OnListingsUpdated;
        public event Action? OnPendingListingsUpdated;
        public event Action? OnAllListingsUpdated;
        public event Action? OnTransactionsUpdated;
        public event Action? OnAllUsersUpdated;

        public RevenueCounter RevenueCounter { get; private set; } = new RevenueCounter();
        public IReadOnlyList<TransactionLedger> ListingFeeTransactions => _listingFeeTransactions;
        public IReadOnlyList<BidIntent> ForfeitedDeposits => _forfeitedDeposits;
        public IReadOnlyList<PayoutRequest> PayoutQueue => _payoutQueue;
        public IReadOnlyList<Dispute> DisputeQueue => _disputeQueue;
        public bool RevenueCounterLoaded { get; private set; }
        public bool ListingFeeTransactionsLoaded { get; private set; }
        public bool ForfeitedDepositsLoaded { get; private set; }
        public bool PayoutQueueLoaded { get; private set; }
        public bool DisputeQueueLoaded { get; private set; }
        public IReadOnlyDictionary<string, string> RevenueDeskErrors => _revenueDeskErrors;
        public event Action? OnRevenueDeskUpdated;

        private List<TransactionLedger> _listingFeeTransactions = new();
        private List<BidIntent> _forfeitedDeposits = new();
        private List<PayoutRequest> _payoutQueue = new();
        private List<Dispute> _disputeQueue = new();
        private readonly Dictionary<string, string> _revenueDeskErrors = new();

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
                await _jsRuntime.InvokeAsync<string>("NUTradeFirebase.subscribeToAllListings", _dotNetRef, nameof(OnAllListingsReceived));
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
                // JS supplies revenue from settled /payments records only; the
                // listing-derived figures are computed in RefreshDerivedCounts.
                var revenue = JsonSerializer.Deserialize<DashboardMetrics>(json, JsonOpts);
                if (revenue != null)
                {
                    Metrics.GrossRevenue = revenue.GrossRevenue;
                    Metrics.TotalTransactionsCount = revenue.TotalTransactionsCount;
                    Metrics.LastUpdated = revenue.LastUpdated ?? DateTime.UtcNow;
                }
                ClearErrorFor("metrics");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] Metrics parse error: {ex.Message}");
            }

            RefreshDerivedCounts();
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
            UsersLoaded = true;
            ClearErrorFor("allUsers");
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
        public void OnAllListingsReceived(string json)
        {
            _allListings = ParseList<MarketplaceListing>(json, "allListings");
            ListingsLoaded = true;
            ClearErrorFor("allListings");
            OnAllListingsUpdated?.Invoke();
            RefreshDerivedCounts();
        }

        [JSInvokable]
        public void OnTransactionsReceived(string json)
        {
            _transactions = ParseList<TransactionLedger>(json, "transactions");
            TransactionsLoaded = true;
            ClearErrorFor("transactions");
            OnTransactionsUpdated?.Invoke();
        }

        // Raised by the JS listeners when a live query fails (typically rules, or
        // a listener attached before the auth token propagated). Clearing the
        // guard lets the next page navigation re-attach instead of staying dead.
        [JSInvokable]
        public void OnListenerError(string source, string message)
        {
            var detail = (message ?? string.Empty).Trim();
            Console.WriteLine($"[FirestoreService] '{source}' listener failed: {detail}");
            Console.WriteLine("[FirestoreService] Firestore rules must let this admin read the collection. " +
                              "Confirm the account carries the admin custom claim.");

            _lastErrorSource = source;
            LastListenerError = detail.Contains("permission", StringComparison.OrdinalIgnoreCase)
                ? "Firestore denied access to live data. Confirm this account has the admin custom claim, then sign out and back in."
                : $"Live data could not be loaded ({source}). {detail}";

            if (source is "allListings" or "listings" or "pendingListings") ListingsLoaded = true;
            if (source == "allUsers") UsersLoaded = true;
            if (source == "transactions") TransactionsLoaded = true;

            _subscribed = false;
            OnMetricsUpdated?.Invoke();
            OnAllListingsUpdated?.Invoke();
            OnAllUsersUpdated?.Invoke();
            OnTransactionsUpdated?.Invoke();
        }

        private void ClearErrorFor(string source)
        {
            if (_lastErrorSource == source)
            {
                _lastErrorSource = null;
                LastListenerError = null;
            }
        }

        private static readonly StringComparison Ci = StringComparison.OrdinalIgnoreCase;

        private void RefreshDerivedCounts()
        {
            var m = Metrics;
            m.ActiveListingsCount = _activeListings.Count;
            m.PendingVerificationsCount = _pendingVerifications.Count;

            var all = _allListings;
            m.TotalListingsCount = all.Count;
            m.TotalBidsPlaced = all.Sum(l => Math.Max(0, l.TotalBids));

            // Only listings that received an auction clock (approved / published) count as auctions.
            var auctioned = all.Where(l => l.AuctionEndsAt.HasValue).ToList();
            m.AuctionedListingsCount = auctioned.Count;
            m.AverageBidsPerItem = auctioned.Count > 0
                ? auctioned.Sum(l => Math.Max(0, l.TotalBids)) / (double)auctioned.Count
                : 0;

            var ended = auctioned.Where(l => l.IsExpired).ToList();
            m.EndedAuctionsCount = ended.Count;
            m.AuctionCompletionRate = ended.Count > 0
                ? ended.Count(l => l.TotalBids > 0) * 100.0 / ended.Count
                : 0;

            var submitted = all.Where(l => !string.Equals(l.Status, "draft", Ci)).ToList();
            m.SubmittedListingsCount = submitted.Count;
            m.FreeToPaidConversionRate = submitted.Count > 0
                ? submitted.Count(l => l.IsPaid) * 100.0 / submitted.Count
                : 0;

            OnMetricsUpdated?.Invoke();
        }

        // ---------------------------------------------------------------
        // Moderation actions
        // ---------------------------------------------------------------

        public Task<FunctionResult> ApproveListingAsync(string listingId) =>
            InvokeFunctionResultAsync("NUTradeFirebase.approveListing", listingId);

        public Task<FunctionResult> RejectListingAsync(string listingId, string? reason) =>
            InvokeFunctionResultAsync("NUTradeFirebase.rejectListing", listingId, reason);

        public Task<FunctionResult> SetUserVerificationAsync(string uid, bool verified, string? reason = null) =>
            string.IsNullOrWhiteSpace(reason)
                ? CallFunctionAsync("setUserVerification", new { uid, verified }, forceTokenRefresh: true)
                : CallFunctionAsync("setUserVerification", new { uid, verified, reason = reason.Trim() }, forceTokenRefresh: true);

        public Task<FunctionResult> CallFunctionAsync(string name, object? payload, bool forceTokenRefresh = false) =>
            InvokeFunctionResultAsync("NUTradeFirebase.callAppFunction", name, payload, forceTokenRefresh);

        private async Task<FunctionResult> InvokeFunctionResultAsync(string identifier, params object?[] args)
        {
            try
            {
                return await _jsRuntime.InvokeAsync<FunctionResult>(identifier, args)
                       ?? FunctionResult.Failure("No response from Cloud Functions.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] {identifier} failed: {ex.Message}");
                return FunctionResult.Failure(ex.Message);
            }
        }

        public async Task<List<BidItem>> GetListingBidsAsync(string listingId) =>
            (await TryGetListingBidsAsync(listingId)).Bids;

        public async Task<BidLoadResult> TryGetListingBidsAsync(string listingId)
        {
            try
            {
                var raw = await _jsRuntime.InvokeAsync<JsonElement>("NUTradeFirebase.getListingBids", listingId);
                if (raw.ValueKind != JsonValueKind.Array) return new BidLoadResult(true, new List<BidItem>(), null);

                var bids = new List<BidItem>();
                foreach (var el in raw.EnumerateArray())
                {
                    var bid = MapBid(el, listingId);
                    if (bid != null) bids.Add(bid);
                }

                return new BidLoadResult(true,
                    bids.OrderByDescending(b => b.Amount).ThenBy(b => b.Timestamp ?? DateTime.MaxValue).ToList(),
                    null);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] GetListingBids failed: {ex.Message}");
                var message = ex.Message.Contains("permission", StringComparison.OrdinalIgnoreCase)
                    ? "Firestore denied access to this listing's bids."
                    : "The bid history could not be loaded.";
                return new BidLoadResult(false, new List<BidItem>(), message);
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

                bid.Timestamp ??= FirstDateTime(el, "createdAt", "placedAt", "bidAt", "updatedAt");

                if (string.IsNullOrEmpty(bid.Status))
                    bid.Status = FirstString(el, "bidStatus", "state") ?? string.Empty;

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

        // ---------------------------------------------------------------
        // Revenue Desk
        // ---------------------------------------------------------------

        public async Task SubscribeRevenueDeskAsync()
        {
            try
            {
                _dotNetRef ??= DotNetObjectReference.Create(this);
                await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.initFirebase");
                await _jsRuntime.InvokeAsync<bool>("NUTradeFirebase.subscribeToRevenueDesk", _dotNetRef);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] Revenue Desk subscription error: {ex.Message}");
                OnRevenueDeskError("revenueDesk", ex.Message);
            }
        }

        public async Task UnsubscribeRevenueDeskAsync()
        {
            try
            {
                await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.unsubscribeRevenueDesk");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] Revenue Desk unsubscribe warning: {ex.Message}");
            }
        }

        [JSInvokable]
        public void OnRevenueCounterReceived(string json)
        {
            try
            {
                RevenueCounter = JsonSerializer.Deserialize<RevenueCounter>(json, JsonOpts) ?? new RevenueCounter();
                _revenueDeskErrors.Remove("revenueCounter");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FirestoreService] counters/revenue parse error: {ex.Message}");
            }
            RevenueCounterLoaded = true;
            OnRevenueDeskUpdated?.Invoke();
        }

        [JSInvokable]
        public void OnRevenueTransactionsReceived(string json)
        {
            _listingFeeTransactions = ParseList<TransactionLedger>(json, "revenueTransactions")
                .OrderByDescending(t => t.Timestamp ?? DateTime.MinValue).ToList();
            ListingFeeTransactionsLoaded = true;
            _revenueDeskErrors.Remove("revenueTransactions");
            OnRevenueDeskUpdated?.Invoke();
        }

        [JSInvokable]
        public void OnForfeitedDepositsReceived(string json)
        {
            _forfeitedDeposits = ParseList<BidIntent>(json, "forfeitedDeposits")
                .OrderByDescending(b => b.ResolvedAt ?? b.CreatedAt ?? DateTime.MinValue).ToList();
            ForfeitedDepositsLoaded = true;
            _revenueDeskErrors.Remove("forfeitedDeposits");
            OnRevenueDeskUpdated?.Invoke();
        }

        [JSInvokable]
        public void OnPayoutQueueReceived(string json)
        {
            _payoutQueue = ParseList<PayoutRequest>(json, "payoutQueue")
                .OrderBy(p => p.CreatedAt ?? DateTime.MaxValue).ToList();
            PayoutQueueLoaded = true;
            _revenueDeskErrors.Remove("payoutQueue");
            OnRevenueDeskUpdated?.Invoke();
        }

        [JSInvokable]
        public void OnDisputeQueueReceived(string json)
        {
            _disputeQueue = ParseList<Dispute>(json, "disputeQueue")
                .OrderBy(d => d.CreatedAt ?? DateTime.MaxValue).ToList();
            DisputeQueueLoaded = true;
            _revenueDeskErrors.Remove("disputeQueue");
            OnRevenueDeskUpdated?.Invoke();
        }

        [JSInvokable]
        public void OnRevenueDeskError(string source, string message)
        {
            var detail = (message ?? string.Empty).Trim();
            Console.WriteLine($"[FirestoreService] Revenue Desk '{source}' listener failed: {detail}");
            _revenueDeskErrors[source] = detail.Contains("permission", StringComparison.OrdinalIgnoreCase)
                ? "Firestore denied access to this data for the signed-in admin."
                : $"This data could not be loaded. {detail}";

            switch (source)
            {
                case "revenueCounter": RevenueCounterLoaded = true; break;
                case "revenueTransactions": ListingFeeTransactionsLoaded = true; break;
                case "forfeitedDeposits": ForfeitedDepositsLoaded = true; break;
                case "payoutQueue": PayoutQueueLoaded = true; break;
                case "disputeQueue": DisputeQueueLoaded = true; break;
                default:
                    RevenueCounterLoaded = ListingFeeTransactionsLoaded = ForfeitedDepositsLoaded =
                        PayoutQueueLoaded = DisputeQueueLoaded = true;
                    break;
            }
            OnRevenueDeskUpdated?.Invoke();
        }

        public Task<FunctionResult> MarkPayoutPaidAsync(string payoutRequestId) =>
            CallFunctionAsync("markPayoutPaid", new { payoutRequestId }, forceTokenRefresh: true);

        public Task<FunctionResult> DeclinePayoutAsync(string payoutRequestId, string? reason) =>
            string.IsNullOrWhiteSpace(reason)
                ? CallFunctionAsync("declinePayout", new { payoutRequestId }, forceTokenRefresh: true)
                : CallFunctionAsync("declinePayout", new { payoutRequestId, reason = reason.Trim() }, forceTokenRefresh: true);

        public Task<FunctionResult> ResolveDisputeAsync(string disputeId, string resolution) =>
            CallFunctionAsync("resolveDispute", new { disputeId, resolution }, forceTokenRefresh: true);

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
