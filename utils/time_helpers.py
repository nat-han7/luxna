from datetime import datetime, timedelta
from typing import Optional


def time_ago(date_str: str, date_format: str = "%Y-%m-%d") -> str:
    """
    Calculate relative time string from a date string.
    
    Args:
        date_str: Date string in the specified format
        date_format: Format of the input date string (default: YYYY-MM-DD)
    
    Returns:
        Relative time string like "today", "yesterday", "1 week ago", etc.
    """
    if not date_str:
        return ""
    
    try:
        # Parse the date string
        date_obj = datetime.strptime(date_str, date_format)
        
        # Set time to beginning of day for accurate day comparison
        date_obj = date_obj.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Get current date (also set to beginning of day)
        now = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Calculate the difference
        delta = now - date_obj
        delta_days = delta.days
        
        # Handle future dates
        if delta_days < 0:
            return "in the future"
        
        # Today
        if delta_days == 0:
            return "today"
        
        # Yesterday
        if delta_days == 1:
            return "yesterday"
        
        # This week
        if delta_days < 7:
            return f"{delta_days} days ago"
        
        # Last week
        if delta_days < 14:
            return "last week"
        
        # Weeks
        if delta_days < 30:
            weeks = delta_days // 7
            if weeks == 1:
                return "1 week ago"
            return f"{weeks} weeks ago"
        
        # Last month
        if delta_days < 60:
            return "last month"
        
        # Months
        if delta_days < 365:
            months = delta_days // 30
            if months == 1:
                return "1 month ago"
            return f"{months} months ago"
        
        # Last year
        if delta_days < 730:
            return "last year"
        
        # Years
        years = delta_days // 365
        if years == 1:
            return "1 year ago"
        return f"{years} years ago"
        
    except (ValueError, TypeError) as e:
        # If date parsing fails, return the original string
        return date_str


def time_ago_with_datetime(dt: datetime) -> str:
    """
    Calculate relative time string from a datetime object.
    
    Args:
        dt: datetime object
    
    Returns:
        Relative time string like "today", "yesterday", "1 week ago", etc.
    """
    if not dt:
        return ""
    
    # Convert to date string and use the main function
    date_str = dt.strftime("%Y-%m-%d")
    return time_ago(date_str)
