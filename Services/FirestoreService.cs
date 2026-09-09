using System.Text.Json;
using Microsoft.JSInterop;
using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public class FirestoreService : IFirestoreService
{
    private readonly IJSRuntime _jsRuntime;
    private readonly ToastService _toastService;
    private DotNetObjectReference<FirestoreService>? _dotNetRef;
    private bool _isSubscribed = false;

    private DashboardMetrics _metrics = new();
    private List<UserProfile> _pendingVerifications = new();
    private List<MarketplaceListing> _activeListings = new();
    private List<TransactionLedger> _transactions = new();

    public DashboardMetrics Metrics => _metrics;
    public IReadOnlyList<UserProfile> PendingVerifications => _pendingVerifications;
    public IReadOnlyList<MarketplaceListing> ActiveListings => _activeListings;
    public IReadOnlyList<TransactionLedger> Transactions => _transactions;

    public event Action? OnMetricsUpdated;
    public event Action? OnVerificationsUpdated;
    public event Action? OnListingsUpdated;
    public event Action? OnTransactionsUpdated;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public FirestoreService(IJSRuntime jsRuntime, ToastService toastService)
    {
        _jsRuntime = jsRuntime;
        _toastService = toastService;
    }

    public async Task InitializeSubscriptionsAsync()
    {
        if (_isSubscribed) return;

        try
        {
            _dotNetRef = DotNetObjectReference.Create(this);

            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.subscribeToMetrics", _dotNetRef, nameof(OnMetricsReceived));
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.subscribeToPendingVerifications", _dotNetRef, nameof(OnVerificationsReceived));
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.subscribeToListings", _dotNetRef, nameof(OnListingsReceived));
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.subscribeToTransactions", _dotNetRef, nameof(OnTransactionsReceived));

            _isSubscribed = true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FirestoreService] Subscription init error: {ex.Message}");
        }
    }

    [JSInvokable]
    public void OnMetricsReceived(string json)
    {
        try
        {
            var data = JsonSerializer.Deserialize<DashboardMetrics>(json, JsonOpts);
            if (data != null)
            {
                _metrics = data;
                OnMetricsUpdated?.Invoke();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FirestoreService] Metrics parse error: {ex.Message}");
        }
    }

    [JSInvokable]
    public void OnVerificationsReceived(string json)
    {
        try
        {
            var data = JsonSerializer.Deserialize<List<UserProfile>>(json, JsonOpts);
            if (data != null)
            {
                _pendingVerifications = data;
                OnVerificationsUpdated?.Invoke();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FirestoreService] Verifications parse error: {ex.Message}");
        }
    }

    [JSInvokable]
    public void OnListingsReceived(string json)
    {
        try
        {
            var data = JsonSerializer.Deserialize<List<MarketplaceListing>>(json, JsonOpts);
            if (data != null)
            {
                _activeListings = data;
                OnListingsUpdated?.Invoke();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FirestoreService] Listings parse error: {ex.Message}");
        }
    }

    [JSInvokable]
    public void OnTransactionsReceived(string json)
    {
        try
        {
            var data = JsonSerializer.Deserialize<List<TransactionLedger>>(json, JsonOpts);
            if (data != null)
            {
                _transactions = data;
                OnTransactionsUpdated?.Invoke();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FirestoreService] Transactions parse error: {ex.Message}");
        }
    }

    public async Task<bool> ApproveVerificationAsync(string uid)
    {
        try
        {
            bool ok = await _jsRuntime.InvokeAsync<bool>("NUTradeFirebase.updateVerificationStatus", uid, "verified", (string?)null);
            if (ok)
            {
                _toastService.ShowSuccess("Email verified. Posting, bidding, and chatting privileges unlocked.", "Verification Granted");
                return true;
            }
        }
        catch (Exception ex)
        {
            _toastService.ShowError($"Failed to approve student: {ex.Message}", "Action Failed");
        }
        return false;
    }

    public async Task<bool> RejectVerificationAsync(string uid, string? reason)
    {
        try
        {
            bool ok = await _jsRuntime.InvokeAsync<bool>("NUTradeFirebase.updateVerificationStatus", uid, "rejected", reason);
            if (ok)
            {
                _toastService.ShowWarning($"Email verification rejected. Reason: {reason ?? "Not specified"}", "Verification Rejected");
                return true;
            }
        }
        catch (Exception ex)
        {
            _toastService.ShowError($"Failed to reject student: {ex.Message}", "Action Failed");
        }
        return false;
    }

    public async Task<bool> UnpublishListingAsync(string listingId)
    {
        try
        {
            bool ok = await _jsRuntime.InvokeAsync<bool>("NUTradeFirebase.updateListingStatus", listingId, "unpublished");
            if (ok)
            {
                _toastService.ShowWarning($"Listing #{listingId} has been unpublished by admin override.", "Listing Moderated");
                return true;
            }
        }
        catch (Exception ex)
        {
            _toastService.ShowError($"Failed to unpublish listing: {ex.Message}", "Action Failed");
        }
        return false;
    }

    public async Task<bool> ToggleListingStatusAsync(string listingId, string newStatus)
    {
        try
        {
            bool ok = await _jsRuntime.InvokeAsync<bool>("NUTradeFirebase.updateListingStatus", listingId, newStatus);
            if (ok)
            {
                _toastService.ShowInfo($"Listing #{listingId} status set to '{newStatus}'.", "Manual Override");
                return true;
            }
        }
        catch (Exception ex)
        {
            _toastService.ShowError($"Override failed: {ex.Message}", "Action Failed");
        }
        return false;
    }

    public async Task<List<BidItem>> GetListingBidsAsync(string listingId)
    {
        try
        {
            var res = await _jsRuntime.InvokeAsync<List<BidItem>>("NUTradeFirebase.getListingBids", listingId);
            return res ?? new List<BidItem>();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FirestoreService] GetListingBids error: {ex.Message}");
            return new List<BidItem>();
        }
    }

    public async ValueTask DisposeAsync()
    {
        _dotNetRef?.Dispose();
        await Task.CompletedTask;
    }
}
