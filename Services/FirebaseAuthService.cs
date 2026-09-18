using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.JSInterop;
using NUTrade.Admin.Models;

namespace NUTrade.Admin.Services;

public class FirebaseAuthService : IFirebaseAuthService
{
    private readonly IJSRuntime _jsRuntime;
    private readonly ToastService _toastService;
    private readonly IFirestoreService _firestoreService;
    private UserProfile? _currentUser;
    private bool _isSecurityVerified = false;
    private DateTime? _securityCodeExpiresAt;
    private string? _lastGeneratedCode;

    public UserProfile? CurrentUser => _currentUser;
    public bool IsAuthenticated => _currentUser != null && _currentUser.IsAdmin && _currentUser.IsVerified && _currentUser.EmailVerified;
    public bool IsSecurityVerified => IsAuthenticated && _isSecurityVerified;
    public DateTime? SecurityCodeExpiresAt => _securityCodeExpiresAt;
    public string? LastGeneratedCode => _lastGeneratedCode;
    public event Action? OnAuthStateChanged;

    public FirebaseAuthService(IJSRuntime jsRuntime, ToastService toastService, IFirestoreService firestoreService)
    {
        _jsRuntime = jsRuntime;
        _toastService = toastService;
        _firestoreService = firestoreService;
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
            // Reset security verification state on new login attempt
            _isSecurityVerified = false;
            _securityCodeExpiresAt = null;

            // 1. Invoke JS Interop to authenticate with Firebase Auth & query users/{uid}
            var response = await _jsRuntime.InvokeAsync<JsonElement>("NUTradeFirebase.signInWithEmailPassword", email, password);

            bool success = response.TryGetProperty("success", out var successProp) && successProp.GetBoolean();
            bool isEmailUnverified = response.TryGetProperty("isEmailUnverified", out var unverifiedProp) && unverifiedProp.GetBoolean();

            if (isEmailUnverified)
            {
                string targetEmail = response.TryGetProperty("unverifiedEmail", out var uEmailProp) ? (uEmailProp.GetString() ?? email) : email;
                await SignOutAsync();
                return new AuthResult
                {
                    Success = false,
                    IsEmailUnverified = true,
                    UnverifiedEmail = targetEmail,
                    ErrorMessage = $"Your admin account email ({targetEmail}) is not yet verified. Please verify your email before accessing the admin dashboard."
                };
            }

            if (!success)
            {
                string errorMsg = response.TryGetProperty("errorMessage", out var errProp) 
                    ? (errProp.GetString() ?? "Unauthorized access: Admin privileges required.") 
                    : "Unauthorized access: Admin privileges required.";

                await SignOutAsync();
                _toastService.ShowError(errorMsg, "Access Denied");
                return new AuthResult { Success = false, ErrorMessage = errorMsg };
            }

            if (response.TryGetProperty("user", out var userProp))
            {
                var profile = JsonSerializer.Deserialize<UserProfile>(userProp.GetRawText(), new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                if (profile == null || !profile.IsAdmin || !profile.IsVerified)
                {
                    await SignOutAsync();
                    const string unauthorizedMsg = "Unauthorized access: Admin privileges required.";
                    _toastService.ShowError(unauthorizedMsg, "Access Denied");
                    return new AuthResult { Success = false, ErrorMessage = unauthorizedMsg };
                }

                if (!profile.EmailVerified)
                {
                    await SignOutAsync();
                    return new AuthResult
                    {
                        Success = false,
                        IsEmailUnverified = true,
                        UnverifiedEmail = profile.Email,
                        ErrorMessage = $"Your admin account email ({profile.Email}) is not yet verified. Please check your inbox and verify your email to access the admin dashboard."
                    };
                }

                _currentUser = profile;
                _isSecurityVerified = false; // Security verification is required before granting access to dashboard

                // Automatically generate a 3-minute random 6-digit security code upon successful Firebase auth
                await GenerateSecurityCodeAsync();

                OnAuthStateChanged?.Invoke();

                return new AuthResult
                {
                    Success = true,
                    User = profile,
                    RequiresSecurityVerification = true,
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

    public async Task<SecurityVerificationResult> GenerateSecurityCodeAsync()
    {
        if (_currentUser == null || !_currentUser.IsAdmin || !_currentUser.EmailVerified)
        {
            return new SecurityVerificationResult { Success = false, ErrorMessage = "You are not authorized to access the Admin Dashboard." };
        }

        try
        {
            // Generate a RANDOM 6-digit numeric security code
            string randomCode = RandomNumberGenerator.GetInt32(100000, 1000000).ToString("D6");
            _securityCodeExpiresAt = DateTime.UtcNow.AddMinutes(3);
            _lastGeneratedCode = randomCode;

            // Compute SHA-256 hash so plain text code is NEVER stored in frontend/browser
            string codeHash = ComputeSha256(randomCode);

            // Store codeHash and expiration in Firestore admin_security_codes/{uid}
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.saveSecurityCodeHash", _currentUser.Uid, codeHash, _securityCodeExpiresAt.Value.ToString("o"));
            
            // Dispatch notification to admin email / log
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.sendSecurityCodeEmail", _currentUser.Email, randomCode);

            _toastService.ShowInfo($"A 6-digit security code has been sent to your email ({_currentUser.Email}). Valid for 3 mins.", "Security Code Sent");

            return new SecurityVerificationResult
            {
                Success = true,
                ExpiresAt = _securityCodeExpiresAt
            };
        }
        catch (Exception ex)
        {
            _toastService.ShowError($"Failed to generate security code: {ex.Message}", "Error");
            return new SecurityVerificationResult { Success = false, ErrorMessage = "Unable to verify the security code. Please try again." };
        }
    }

    public async Task<SecurityVerificationResult> VerifySecurityCodeAsync(string enteredCode)
    {
        if (_currentUser == null || !_currentUser.IsAdmin || !_currentUser.EmailVerified)
        {
            return new SecurityVerificationResult { Success = false, ErrorMessage = "You are not authorized to access the Admin Dashboard." };
        }

        if (string.IsNullOrWhiteSpace(enteredCode) || enteredCode.Trim().Length != 6)
        {
            return new SecurityVerificationResult { Success = false, ErrorMessage = "Invalid security code. Please try again." };
        }

        if (_securityCodeExpiresAt == null || DateTime.UtcNow > _securityCodeExpiresAt.Value)
        {
            return new SecurityVerificationResult { Success = false, IsExpired = true, ErrorMessage = "This security code has expired. A new code is now required." };
        }

        try
        {
            // Fetch stored hash from Firestore backend
            var recordJson = await _jsRuntime.InvokeAsync<JsonElement?>("NUTradeFirebase.getSecurityCodeHash", _currentUser.Uid);
            if (!recordJson.HasValue)
            {
                return new SecurityVerificationResult { Success = false, IsExpired = true, ErrorMessage = "This security code has expired. A new code is now required." };
            }

            var record = recordJson.Value;
            string? storedHash = record.TryGetProperty("codeHash", out var hashProp) ? hashProp.GetString() : null;
            
            if (record.TryGetProperty("expiresAt", out var expProp) && DateTime.TryParse(expProp.GetString(), out var firestoreExp))
            {
                if (DateTime.UtcNow > firestoreExp)
                {
                    return new SecurityVerificationResult { Success = false, IsExpired = true, ErrorMessage = "This security code has expired. A new code is now required." };
                }
            }

            string enteredHash = ComputeSha256(enteredCode.Trim());

            if (!string.Equals(storedHash, enteredHash, StringComparison.Ordinal))
            {
                return new SecurityVerificationResult { Success = false, ErrorMessage = "Invalid security code. Please try again." };
            }

            // Code is VALID & NOT EXPIRED -> Mark session security verified!
            _isSecurityVerified = true;
            _securityCodeExpiresAt = null;
            _lastGeneratedCode = null;

            // Delete code record in Firestore
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.deleteSecurityCodeHash", _currentUser.Uid);

            OnAuthStateChanged?.Invoke();
            _toastService.ShowSuccess("Admin Security Verification Successful!", "Access Granted");

            return new SecurityVerificationResult { Success = true };
        }
        catch (Exception ex)
        {
            _toastService.ShowError($"Unable to verify security code: {ex.Message}", "Error");
            return new SecurityVerificationResult { Success = false, ErrorMessage = "Unable to verify the security code. Please try again." };
        }
    }

    public async Task<bool> ResendEmailVerificationAsync(string? email = null)
    {
        try
        {
            bool ok = await _jsRuntime.InvokeAsync<bool>("NUTradeFirebase.sendEmailVerification", email);
            string targetEmail = email ?? _currentUser?.Email ?? "your registered email address";
            if (ok)
            {
                _toastService.ShowSuccess($"Verification email sent to {targetEmail}. Please check your inbox and verify before logging in.", "Verification Sent");
                return true;
            }
        }
        catch (Exception ex)
        {
            _toastService.ShowError($"Failed to send verification email: {ex.Message}", "Error");
        }
        return false;
    }

    public async Task SignOutAsync()
    {
        try
        {
            // Tear down Firestore real-time listeners before auth sign-out so they
            // can be safely re-initialized on the next login without duplicates.
            await _firestoreService.UnsubscribeAllAsync();
            await _jsRuntime.InvokeVoidAsync("NUTradeFirebase.signOut");
        }
        catch
        {
            // Ignored if JS not attached
        }
        finally
        {
            _currentUser = null;
            _isSecurityVerified = false;
            _securityCodeExpiresAt = null;
            _lastGeneratedCode = null;
            OnAuthStateChanged?.Invoke();
        }
    }

    public Task<UserProfile?> GetCurrentProfileAsync()
    {
        return Task.FromResult(_currentUser);
    }

    private static string ComputeSha256(string input)
    {
        using var sha256 = SHA256.Create();
        byte[] bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(input));
        var builder = new StringBuilder();
        foreach (byte b in bytes)
        {
            builder.Append(b.ToString("x2"));
        }
        return builder.ToString();
    }
}
