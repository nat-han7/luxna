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
            return "in Zukunft"
        
        # Today
        if delta_days == 0:
            return "heute"
        
        # Yesterday
        if delta_days == 1:
            return "gestern"
        
        # This week
        if delta_days < 7:
            return f"vor {delta_days} Tagen"
        
        # Last week
        if delta_days < 14:
            return "letzte Woche"
        
        # Weeks
        if delta_days < 30:
            weeks = delta_days // 7
            if weeks == 1:
                return "vor 1 Woche"
            return f"vor {weeks} Wochen"
        
        # Last month
        if delta_days < 60:
            return "letzten Monat"
        
        # Months
        if delta_days < 365:
            months = delta_days // 30
            if months == 1:
                return "vor 1 Monat"
            return f"vor {months} Monaten"
        
        # Last year
        if delta_days < 730:
            return "letztes Jahr"
        
        # Years
        years = delta_days // 365
        if years == 1:
            return "vor 1 Jahr"
        return f"vor {years} Jahren"
        
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
