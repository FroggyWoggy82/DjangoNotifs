# In Notifications/tasks.py
from celery import shared_task
from datetime import timedelta
import json
import time  # Add this import for the test notification function
from pywebpush import webpush, WebPushException
from django.conf import settings
from django.utils import timezone
from .models import Notification, PushSubscription

@shared_task
def send_push_notification(notification_id):
    try:
        notification = Notification.objects.get(id=notification_id)
        print(f"Sending notification {notification_id}: {notification.title}")
        
        # Mark as sent
        notification.sent = True
        notification.save()
        
        # If this is a recurring notification, schedule the next occurrence
        if notification.repeat != 'none':
            if notification.repeat == 'daily':
                next_time = notification.scheduled_time + timedelta(days=1)
            elif notification.repeat == 'weekly':
                next_time = notification.scheduled_time + timedelta(weeks=1)
                
            # Create a new notification for the next occurrence
            new_notification = Notification.objects.create(
                user=notification.user,
                title=notification.title,
                body=notification.body,
                scheduled_time=next_time,
                repeat=notification.repeat
            )
            
            # Schedule the next push notification
            schedule_notification_task(new_notification.id, next_time)
        
        # Get all subscriptions for this user
        if notification.user:
            subscriptions = PushSubscription.objects.filter(user=notification.user)
        else:
            subscriptions = PushSubscription.objects.filter(user=None)
            
        # Send push notification to all subscriptions
        for subscription in subscriptions:
            try:
                subscription_data = subscription.subscription_json
                print(f"Sending to subscription: {subscription.id}")
                
                payload = json.dumps({
                    "title": notification.title,
                    "body": notification.body,
                    "data": {
                        "notificationId": notification.id
                    }
                })
                
                # VAPID keys should be configured in your settings
                vapid_claims = {
                    "sub": f"mailto:{settings.VAPID_ADMIN_EMAIL}"
                }
                
                # Send the push notification
                webpush(
                    subscription_info=subscription_data,
                    data=payload,
                    vapid_private_key=settings.VAPID_PRIVATE_KEY,
                    vapid_claims=vapid_claims
                )
                print(f"Successfully sent to subscription {subscription.id}")
            except WebPushException as e:
                print(f"WebPush failed for subscription {subscription.id}: {e}")
                print(f"Response status: {e.response.status_code if e.response else 'No response'}")
                print(f"Response body: {e.response.text if e.response else 'No response'}")
                # If subscription is expired or invalid, remove it
                if e.response and e.response.status_code in [404, 410]:
                    subscription.delete()
            except Exception as e:
                print(f"Failed to send to subscription {subscription.id}: {str(e)}")
                
    except Notification.DoesNotExist:
        print(f"Notification {notification_id} not found")
    except Exception as e:
        print(f"Error sending push notification: {str(e)}")

@shared_task
def schedule_notification_task(notification_id, scheduled_time=None):
    try:
        notification = Notification.objects.get(id=notification_id)
        
        # If time is provided, use it; otherwise use the notification's scheduled time
        if scheduled_time is None:
            scheduled_time = notification.scheduled_time
        
        # Schedule the task at the appropriate time
        send_push_notification.apply_async(
            args=[notification_id],
            eta=scheduled_time
        )
        
        return f"Scheduled notification {notification_id} for {scheduled_time}"
    except Exception as e:
        return f"Failed to schedule notification: {str(e)}"

@shared_task
def check_pending_notifications():
    """
    Check for notifications that should be sent but haven't been.
    This is a safeguard in case the scheduled tasks don't run correctly.
    """
    now = timezone.now()
    due_notifications = Notification.objects.filter(
        scheduled_time__lte=now,
        sent=False
    )
    
    for notification in due_notifications:
        send_push_notification.delay(notification.id)
    
    return f"Checked for pending notifications. Found {due_notifications.count()}"

@shared_task
def send_test_push_notification(subscription):
    try:
        # iOS-optimized payload structure
        payload = json.dumps({
            'title': 'Subscription Confirmed',
            'body': 'You will now receive background notifications!',
            'data': {
                'dateOfNotification': int(time.time() * 1000),
                'url': '/'  # iOS often needs a URL to open
            }
        })
        
        # VAPID keys should be configured in your settings
        vapid_claims = {
            "sub": f"mailto:{settings.VAPID_ADMIN_EMAIL}"
        }
        
        # Send the push notification with proper error handling
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims=vapid_claims
        )
        return True
    except Exception as e:
        print(f"Error sending test notification: {e}")