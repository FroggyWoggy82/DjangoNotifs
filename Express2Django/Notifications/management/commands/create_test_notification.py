from django.core.management.base import BaseCommand
from Notifications.models import Notification
from django.utils import timezone
from datetime import timedelta

class Command(BaseCommand):
    help = 'Creates a test notification'

    def handle(self, *args, **options):
        scheduled_time = timezone.now() + timedelta(minutes=1)
        notification = Notification.objects.create(
            title="Test Notification",
            body="This is a test notification from management command",
            scheduled_time=scheduled_time,
            repeat="none",
            sent=False
        )
        self.stdout.write(self.style.SUCCESS(f'Successfully created notification ID: {notification.id} for time: {scheduled_time}'))