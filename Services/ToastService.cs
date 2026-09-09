namespace NUTrade.Admin.Services;

public enum ToastLevel
{
    Info,
    Success,
    Warning,
    Error
}

public class ToastMessage
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Message { get; set; } = string.Empty;
    public string? Title { get; set; }
    public ToastLevel Level { get; set; } = ToastLevel.Info;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

public class ToastService
{
    public event Action<ToastMessage>? OnShow;

    public void ShowToast(string message, ToastLevel level = ToastLevel.Info, string? title = null)
    {
        OnShow?.Invoke(new ToastMessage
        {
            Message = message,
            Level = level,
            Title = title
        });
    }

    public void ShowSuccess(string message, string? title = "Success") => ShowToast(message, ToastLevel.Success, title);
    public void ShowError(string message, string? title = "Access Denied") => ShowToast(message, ToastLevel.Error, title);
    public void ShowWarning(string message, string? title = "Warning") => ShowToast(message, ToastLevel.Warning, title);
    public void ShowInfo(string message, string? title = "Notice") => ShowToast(message, ToastLevel.Info, title);
}
