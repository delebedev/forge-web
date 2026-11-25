export interface paths {
  '/api/auth/me': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['AuthView']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/auth/guest': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['AuthView']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Too Many Requests */
        429: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/auth/request-code': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody: {
        content: {
          'application/json': components['schemas']['RequestLoginCodeRequestInput']
        }
      }
      responses: {
        /** @description No Content */
        204: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Too Many Requests */
        429: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Service Unavailable */
        503: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
      }
    }
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/auth/verify': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody: {
        content: {
          'application/json': components['schemas']['VerifyLoginCodeRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['LoginResponse']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Too Many Requests */
        429: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/auth/logout': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description No Content */
        204: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/roadmap': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['RoadmapItem'][]
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/roadmap/{itemId}/vote': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put: {
      parameters: {
        query?: never
        header?: never
        path: {
          itemId: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description No Content */
        204: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Forbidden */
        403: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    post?: never
    delete: {
      parameters: {
        query?: never
        header?: never
        path: {
          itemId: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description No Content */
        204: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Forbidden */
        403: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/puzzles': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['GeneratedPuzzle'][]
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/puzzles/runs/{runId}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path: {
          runId: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['PuzzleRun']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/puzzles/{puzzleId}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path: {
          puzzleId: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['GeneratedPuzzle']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/puzzles/{puzzleId}/ratings': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: {
      parameters: {
        query?: never
        header?: never
        path: {
          puzzleId: string
        }
        cookie?: never
      }
      requestBody: {
        content: {
          'application/json': components['schemas']['PuzzleRatingRequestInput']
        }
      }
      responses: {
        /** @description No Content */
        204: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Too Many Requests */
        429: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/public/cards/by-grpids': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query: {
          ids: string
          abilities?: boolean
        }
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': {
              [key: string]: components['schemas']['GreCardMetaDto']
            }
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/public/cards/image': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query: {
          name: string
          version?: string
          face?: string
        }
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description Found */
        302: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/dev/challenges': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['ChallengeSummary'][]
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/dev/puzzles/{puzzleId}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path: {
          puzzleId: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DevelopmentPuzzle']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/collection': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: {
          playerId?: string
        }
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['CollectionView']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Forbidden */
        403: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/cards/metadata': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['CardMetadataView']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/cards/search': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query: {
          q: string
          colors?: string
          limit?: number
        }
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DraftCardDto'][]
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/cards/parse-decklist': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody: {
        content: {
          'application/json': components['schemas']['ParseDecklistRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['ParseDecklistResponse']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['ParseDecklistErrorResponse']
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/cards/validate-decklist': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody: {
        content: {
          'application/json': components['schemas']['ValidateDecklistRequestInput']
        }
      }
      responses: {
        /** @description No Content */
        204: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['ParseDecklistErrorResponse']
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/course-records': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['CourseRecord'][]
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/course-records/{eventName}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path: {
          eventName: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['CourseRecord']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put: {
      parameters: {
        query?: never
        header?: never
        path: {
          eventName: string
        }
        cookie?: never
      }
      requestBody: {
        content: {
          'application/json': components['schemas']['SaveCourseRecordRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['CourseRecord']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Conflict */
        409: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Payload Too Large */
        413: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    post?: never
    delete: {
      parameters: {
        query?: {
          revision?: number
        }
        header?: never
        path: {
          eventName: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description No Content */
        204: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Conflict */
        409: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/decks': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: {
          playerId?: string
        }
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DeckView'][]
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Forbidden */
        403: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put?: never
    post: {
      parameters: {
        query?: never
        header?: never
        path?: never
        cookie?: never
      }
      requestBody: {
        content: {
          'application/json': components['schemas']['CreateDeckRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DeckView']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['ParseDecklistErrorResponse']
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Forbidden */
        403: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/decks/{deckId}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query?: never
        header?: never
        path: {
          deckId: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DeckView']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    put: {
      parameters: {
        query?: never
        header?: never
        path: {
          deckId: string
        }
        cookie?: never
      }
      requestBody: {
        content: {
          'application/json': components['schemas']['CreateDeckRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DeckView']
          }
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['ParseDecklistErrorResponse']
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Forbidden */
        403: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    post?: never
    delete: {
      parameters: {
        query?: never
        header?: never
        path: {
          deckId: string
        }
        cookie?: never
      }
      requestBody?: never
      responses: {
        /** @description No Content */
        204: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Bad Request */
        400: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
        /** @description Unauthorized */
        401: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Not Found */
        404: {
          headers: {
            [name: string]: unknown
          }
          content?: never
        }
        /** @description Internal Server Error */
        500: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'text/plain': string
          }
        }
      }
    }
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
}
export type webhooks = Record<string, never>
export interface components {
  schemas: {
    /** AuthView */
    AuthView: {
      playerId: string | null
      guest: boolean
    }
    /** RequestLoginCodeRequestInput */
    RequestLoginCodeRequestInput: {
      email: string
    }
    /** VerifyLoginCodeRequestInput */
    VerifyLoginCodeRequestInput: {
      email: string
      code: string
    }
    /** LoginResponse */
    LoginResponse: {
      playerId: string
      email: string
    }
    /** RoadmapItem */
    RoadmapItem: {
      id: string
      title: string
      description: string
      status: string
      note: string | null
      statusUpdatedAt: string | null
      /** Format: int32 */
      votes: number
      voted: boolean
    }
    /** GeneratedPuzzle */
    GeneratedPuzzle: {
      id: string
      title: string
      text: string
      createdAt: string
    }
    /** PuzzleAttempt */
    PuzzleAttempt: {
      featuredCard: string
      puzzleText: string | null
      validation: string | null
      trial: string | null
      withoutFeaturedTrial: string | null
      jevAssessment: string | null
      rejection: string | null
    }
    /** PuzzleRun */
    PuzzleRun: {
      id: string
      ownerId: string
      createdAt: string
      updatedAt: string
      status: string
      stage: string
      model: string
      promptVersion: string
      sampledCards: string[]
      attempts: components['schemas']['PuzzleAttempt'][]
      puzzleId: string | null
      error: string | null
    }
    /** PuzzleRatingRequestInput */
    PuzzleRatingRequestInput: {
      reaction: string
      comment?: string | null
      outcome: string
      actions?: string[]
    }
    /** GreMechanicHelpDto */
    GreMechanicHelpDto: {
      keyword: string
      title: string
      description: string
      cost: string | null
    }
    /** GreAbilityMetaDto */
    GreAbilityMetaDto: {
      text: string
      keyword: string | null
      manaCost: string | null
    }
    /** GreCardMetaDto */
    GreCardMetaDto: {
      /** Format: int32 */
      grpId: number
      name: string | null
      setCode: string | null
      rarity: string | null
      /** Format: int32 */
      titleId: number | null
      manaCost: string | null
      power: string | null
      toughness: string | null
      loyalty: string | null
      defense: string | null
      faceLayout: string | null
      types: string | null
      subtypes: string | null
      rulesText: string | null
      imageUrl: string | null
      keywords: string[]
      mechanicHelp: components['schemas']['GreMechanicHelpDto'][]
      linkedFaceGrpIds: number[]
      abilities: {
        [key: string]: components['schemas']['GreAbilityMetaDto']
      }
    }
    /** ChallengeSummary */
    ChallengeSummary: {
      challengeId: string
      name: string
      objective: string
    }
    /** DevelopmentPuzzle */
    DevelopmentPuzzle: {
      name: string
      objective: string
      text: string
    }
    /** CollectionView */
    CollectionView: {
      grpIds: number[]
    }
    /** CardMetadataEntry */
    CardMetadataEntry: {
      /** Format: int32 */
      grpId: number
      name: string | null
    }
    /** CardMetadataView */
    CardMetadataView: {
      cards: components['schemas']['CardMetadataEntry'][]
    }
    /** DraftCardDto */
    DraftCardDto: {
      name: string
      /** Format: int32 */
      grpId: number | null
      manaCost: string | null
      typeLine: string | null
      rarity: string | null
      colors: string[]
      setCode: string | null
      collectorNumber: string | null
      score: number | null
    }
    /** ParseDecklistRequestInput */
    ParseDecklistRequestInput: {
      text: string
    }
    /** ParseDecklistErrorResponse */
    ParseDecklistErrorResponse: {
      errors: string[]
    }
    /** DecklistCardDto */
    DecklistCardDto: {
      /** Format: int32 */
      grpId: number
      /** Format: int32 */
      quantity: number
      card: components['schemas']['DraftCardDto']
    }
    /** ParseDecklistResponse */
    ParseDecklistResponse: {
      mainboard: components['schemas']['DecklistCardDto'][]
      sideboard: components['schemas']['DecklistCardDto'][]
      commandZone: components['schemas']['DecklistCardDto'][]
    }
    /** ValidateDecklistRequestInput */
    ValidateDecklistRequestInput: {
      text: string
      gameType?: string | null
    }
    /** CourseRecord */
    CourseRecord: {
      eventName: string
      /** Format: int32 */
      revision: number
      document: string
    }
    /** SaveCourseRecordRequestInput */
    SaveCourseRecordRequestInput: {
      /** Format: int32 */
      revision: number
      document: string
    }
    /** WebDeckCard */
    WebDeckCard: {
      cardName: string
      /** Format: int32 */
      quantity: number
    }
    /** DeckView */
    DeckView: {
      id: string
      playerId: string
      name: string
      format: string
      mainDeck: components['schemas']['WebDeckCard'][]
      sideboard: components['schemas']['WebDeckCard'][]
      commandZone: components['schemas']['WebDeckCard'][]
    }
    /** WebDeckCardInput */
    WebDeckCardInput: {
      cardName: string
      /** Format: int32 */
      quantity: number
    }
    /** CreateDeckRequestInput */
    CreateDeckRequestInput: {
      playerId: string
      name: string
      format?: string
      mainDeck: components['schemas']['WebDeckCardInput'][]
      sideboard?: components['schemas']['WebDeckCardInput'][]
      commandZone?: components['schemas']['WebDeckCardInput'][]
    }
  }
  responses: never
  parameters: never
  requestBodies: never
  headers: never
  pathItems: never
}
export type $defs = Record<string, never>
export type operations = Record<string, never>
