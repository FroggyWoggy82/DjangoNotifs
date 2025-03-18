# models.py
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone  # Added import for timezone

class PushSubscription(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    subscription_json = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    last_successful_push = models.DateTimeField(null=True, blank=True)  # Track last successful push
    failed_attempts = models.IntegerField(default=0)  # Track failed attempts

    def __str__(self):
        return f"Subscription for {self.user or 'Anonymous'}"

class Notification(models.Model):
    REPEAT_CHOICES = [
        ('none', 'No repeat'),
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    title = models.CharField(max_length=255)
    body = models.TextField()
    scheduled_time = models.DateTimeField()
    repeat = models.CharField(max_length=10, choices=REPEAT_CHOICES, default='none')
    sent = models.BooleanField(default=False)  # Added field to track if notification has been sent
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"{self.title} at {self.scheduled_time}"