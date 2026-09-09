using System.Text.Json;
using Microsoft.JSInterop;
using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public class FirebaseAuthService : IFirebaseAuthService
{
    private readonly IJSRuntime _jsRuntime;
    private readonly ToastService _toastService;
    private UserProfile? _currentUser;

    public UserProfile? CurrentUser => _currentUser;
    public bool IsAuthenticated => _currentUser != null && _currentUser.IsAdmin && _currentUser.IsVerified;
    public event Action? OnAuthStateChanged;

    public FirebaseAuthService(IJSRuntime jsRuntime, ToastService toastService)
    {
        _jsRuntime = jsRuntime;
        _toastService = toastService;
    }

    public async Task InitializeAsync()
    {
        try
        {
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.initFirebase");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[FirebaseAuthService] Init error: {ex.Message}");
        }
    }

    public async Task<AuthResult> SignInAsync(string email, string password)
    {
        try
        {
            // 1. Invoke JS Interop to authenticate with Firebase Auth & query users/{uid}
            var response = await _jsRuntime.InvokeAsync<JsonElement>("NUTradeFirebase.signInWithEmailPassword", email, password);

            bool success = response.TryGetProperty("success", out var successProp) && successProp.GetBoolean();
            if (!success)
            {
                string errorMsg = response.TryGetProperty("errorMessage", out var errProp) 
                    ? (errProp.GetString() ?? "Unauthorized access: Admin privileges required.") 
                    : "Unauthorized access: Admin privileges required.";

                // Terminate session and show error toast
                await SignOutAsync();
                _toastService.ShowError(errorMsg, "Access Denied");
                return new AuthResult { Success = false, ErrorMessage = errorMsg };
            }

            // Parse User Profile
            if (response.TryGetProperty("user", out var userProp))
            {
                var profile = JsonSerializer.Deserialize<UserProfile>(userProp.GetRawText(), new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                // Secondary strict check in C# layer
                if (profile == null || !profile.IsAdmin || !profile.IsVerified)
                {
                    await SignOutAsync();
                    const string unauthorizedMsg = "Unauthorized access: Admin privileges required.";
                    _toastService.ShowError(unauthorizedMsg, "Access Denied");
                    return new AuthResult { Success = false, ErrorMessage = unauthorizedMsg };
                }

                _currentUser = profile;
                OnAuthStateChanged?.Invoke();

                _toastService.ShowSuccess($"Welcome back, {profile.DisplayName}!", "Authentication Successful");
                return new AuthResult
                {
                    Success = true,
                    User = profile,
                    Token = response.TryGetProperty("token", out var tokenProp) ? tokenProp.GetString() : null
                };
            }

            return new AuthResult { Success = false, ErrorMessage = "Invalid user payload from authentication provider." };
        }
        catch (Exception ex)
        {
            const string fallbackError = "Unauthorized access: Admin privileges required.";
            await SignOutAsync();
            _toastService.ShowError($"{fallbackError} ({ex.Message})", "Error");
            return new AuthResult { Success = false, ErrorMessage = ex.Message };
        }
    }

    public async Task SignOutAsync()
    {
        try
        {
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.signOut");
        }
        catch
        {
            // Ignored if JS not yet attached
        }
        finally
        {
            _currentUser = null;
            OnAuthStateChanged?.Invoke();
        }
    }

    public Task<UserProfile?> GetCurrentProfileAsync()
    {
        return Task.FromResult(_currentUser);
    }
}
