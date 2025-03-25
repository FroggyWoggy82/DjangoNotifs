class ServiceWorkerMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.endswith('/static/service-worker.js'):
            response['Service-Worker-Allowed'] = '/'
        return response