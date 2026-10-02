import { apiRequest } from '../../src/client.js'

await Promise.all([apiRequest('/me'), apiRequest('/me')])
