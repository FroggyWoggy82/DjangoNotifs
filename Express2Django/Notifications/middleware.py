import os
from django.conf import settings

class ServiceWorkerMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        
        # Check for service worker requests - handle both direct and static paths
        if request.path.endswith('/static/service-worker.js') or request.path.endswith('service-worker.js'):
            # Add the Service-Worker-Allowed header to allow controlling the entire site
            response['Service-Worker-Allowed'] = '/'
            
            # Ensure proper content type
            response['Content-Type'] = 'application/javascript'
            
            # Add cache control headers to prevent caching issues
            response['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
            response['Pragma'] = 'no-cache'
            response['Expires'] = '0'
        
        return response