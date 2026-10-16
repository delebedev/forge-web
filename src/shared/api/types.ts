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
  '/api/puzzles/capabilities': {
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
            'application/json': components['schemas']['PuzzleCapabilities']
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
  '/api/puzzles/generate': {
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
        /** @description Accepted */
        202: {
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
        /** @description Forbidden */
        403: {
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
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/gre/start': {
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
          'application/json': components['schemas']['GreStartRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DraftPlayResponse']
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
        /** @description Service Unavailable */
        503: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['MatchCapacityResponse']
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
  '/api/gre/abandon': {
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
          'application/json': components['schemas']['GreAbandonRequestInput']
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
  '/api/public/spectator/start': {
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
            'application/json': components['schemas']['PublicSpectatorResponse']
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
        /** @description Service Unavailable */
        503: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['MatchCapacityResponse']
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
  '/api/public/spectate/viewers': {
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
            'application/json': components['schemas']['ViewerCountView']
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
  '/api/dev/matches/{matchId}/advice': {
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
          matchId: string
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
            'application/json': components['schemas']['CopilotProposal']
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
  '/api/dev/puzzle-candidates': {
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
          'application/json': components['schemas']['DevPuzzleCandidateRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DevPuzzleCandidateValidationResponse']
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
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/dev/puzzle-candidates/{candidateId}/trial': {
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
          candidateId: string
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
            'application/json': components['schemas']['PuzzleTrialResult']
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
            'application/json': components['schemas']['ChallengeSummary']
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
  '/api/courses': {
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
            'application/json': components['schemas']['CourseView'][]
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
  '/api/draft/start': {
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
          'application/json': components['schemas']['StartDraftRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DraftSessionView']
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
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/draft/pick': {
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
          'application/json': components['schemas']['PickDraftRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DraftSessionView']
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
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/draft/status': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: {
      parameters: {
        query: {
          playerId?: string
          eventName: string
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
            'application/json': components['schemas']['DraftSessionView']
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
  '/api/draft/deck': {
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
          'application/json': components['schemas']['SubmitDeckRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['CourseView']
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
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/draft/play': {
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
          'application/json': components['schemas']['PlayDraftRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DraftPlayResponse']
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
        /** @description Service Unavailable */
        503: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['MatchCapacityResponse']
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
  '/api/draft': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete: {
      parameters: {
        query: {
          playerId?: string
          eventName: string
        }
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
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/sealed/sets': {
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
            'application/json': components['schemas']['LimitedSetView'][]
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
  '/api/sealed/start': {
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
          'application/json': components['schemas']['StartDraftRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['CourseView']
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
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/sealed/deck': {
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
          'application/json': components['schemas']['SubmitDeckRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['CourseView']
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
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/sealed/play': {
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
          'application/json': components['schemas']['PlayDraftRequestInput']
        }
      }
      responses: {
        /** @description OK */
        200: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['DraftPlayResponse']
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
        /** @description Service Unavailable */
        503: {
          headers: {
            [name: string]: unknown
          }
          content: {
            'application/json': components['schemas']['MatchCapacityResponse']
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
  '/api/sealed': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    delete: {
      parameters: {
        query: {
          playerId?: string
          eventName: string
        }
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
    /** PuzzleCapabilities */
    PuzzleCapabilities: {
      canGenerate: boolean
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
    /** GreStartRequestInput */
    GreStartRequestInput: {
      matchId?: string | null
      wireMatchId?: string | null
      seat1Deck?: string | null
      seat2Deck?: string | null
      gameVariant?: string | null
      /** Format: int64 */
      seed?: number | null
      challengeId?: string | null
      candidateId?: string | null
      puzzle?: string | null
      spectatorMode?: boolean | null
    }
    /** DraftPlayResponse */
    DraftPlayResponse: {
      matchId: string
      wireMatchId: string
    }
    /** MatchCapacityResponse */
    MatchCapacityResponse: {
      code: string
      message: string
      /** Format: int32 */
      retryAfterSeconds: number
    }
    /** GreAbandonRequestInput */
    GreAbandonRequestInput: {
      matchId: string
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
    /** PublicSeatView */
    PublicSeatView: {
      name: string
    }
    /** PublicSpectatorResponse */
    PublicSpectatorResponse: {
      matchId: string
      wireMatchId: string
      seat1: components['schemas']['PublicSeatView']
      seat2: components['schemas']['PublicSeatView']
    }
    /** ViewerCountView */
    ViewerCountView: {
      /** Format: int32 */
      count: number
    }
    /** EntityRefNullable */
    EntityRefNullable: {
      /** Format: int32 */
      instanceId: number
      kind: string
      name: string | null
      /** Format: int32 */
      grpId: number | null
      zone: string | null
      /** Format: int32 */
      ownerSeat: number | null
    } | null
    /** EntityRef */
    EntityRef: {
      /** Format: int32 */
      instanceId: number
      kind: string
      name: string | null
      /** Format: int32 */
      grpId: number | null
      zone: string | null
      /** Format: int32 */
      ownerSeat: number | null
    }
    /** GroupAssignment */
    GroupAssignment: {
      /** Format: int32 */
      zoneType: number
      /** Format: int32 */
      subZoneType: number
      instanceIds: number[]
    }
    /** CombatDamageRecipient */
    CombatDamageRecipient: {
      /** Format: int32 */
      recipientId: number
      /** Format: int32 */
      amount: number
    }
    /** CombatDamageAssignment */
    CombatDamageAssignment: {
      /** Format: int32 */
      assignerId: number
      recipients: components['schemas']['CombatDamageRecipient'][]
    }
    /** BlockAssignment */
    BlockAssignment: {
      blocker: components['schemas']['EntityRef']
      attacker: components['schemas']['EntityRef']
    }
    /** ManaTypeChoice */
    ManaTypeChoice: {
      /** Format: int32 */
      ctoId: number
      color: string
    }
    /** DistributionAmount */
    DistributionAmount: {
      /** Format: int32 */
      instanceId: number
      /** Format: int32 */
      amount: number
    }
    /** CopilotProposal */
    CopilotProposal: {
      intent: string
      promptType: string
      /** Format: int32 */
      seat: number
      promptKey: string | null
      /** Format: int32 */
      gameStateId: number | null
      /** Format: int32 */
      respId: number | null
      card: components['schemas']['EntityRefNullable']
      /** Format: int32 */
      abilityGrpId: number | null
      /** Format: int32 */
      alternativeGrpId: number | null
      targets: components['schemas']['EntityRef'][]
      targetGroups: {
        [key: string]: number[]
      }
      groupAssignments: components['schemas']['GroupAssignment'][]
      combatDamageAssignments: components['schemas']['CombatDamageAssignment'][]
      blocks: components['schemas']['BlockAssignment'][]
      modalGrpIds: number[]
      manaTypes: components['schemas']['ManaTypeChoice'][]
      /** Format: int32 */
      numericValue: number | null
      distribution: components['schemas']['DistributionAmount'][]
      accept: boolean | null
      /** Format: int32 */
      ctoId: number | null
      /** Format: int32 */
      replacementEffectId: number | null
      responseIds: number[]
      responses: string[]
      reason: string | null
    }
    /** DevPuzzleCandidateRequestInput */
    DevPuzzleCandidateRequestInput: {
      text: string
    }
    /** PuzzleValidationResult */
    PuzzleValidationResult: {
      /** @enum {string} */
      status: 'Loaded' | 'Invalid' | 'Unsupported' | 'EngineFailure'
      issues: string[]
      name: string | null
      goal: string | null
      /** Format: int32 */
      turns: number | null
      /** Format: int32 */
      inputCardCount: number
    }
    /** DevPuzzleCandidateValidationResponse */
    DevPuzzleCandidateValidationResponse: {
      candidateId: string | null
      validation: components['schemas']['PuzzleValidationResult']
    }
    /** PuzzleTrialLimits */
    PuzzleTrialLimits: {
      /** Format: int32 */
      maxDecisions: number
      /** Format: int64 */
      maxElapsedMillis: number
    }
    /** PuzzleTrialDecision */
    PuzzleTrialDecision: {
      /** Format: int32 */
      index: number
      intent: string
      promptType: string
      promptKey: string | null
      /** Format: int32 */
      gameStateId: number | null
      /** Format: int32 */
      respId: number | null
    }
    /** PuzzleTrialOutcomeNullable */
    PuzzleTrialOutcomeNullable: {
      /** Format: int32 */
      playerSeatId: number
      /** Format: int32 */
      winningTeam: number
      won: boolean
    } | null
    /** PuzzleTrialResult */
    PuzzleTrialResult: {
      /** @enum {string} */
      status:
        | 'Won'
        | 'Lost'
        | 'Unsupported'
        | 'AdvisorUnavailable'
        | 'Stalled'
        | 'DecisionBudgetExceeded'
        | 'TimeBudgetExceeded'
        | 'Interrupted'
        | 'EngineFailure'
      definitionId: string
      matchId: string | null
      /** Format: int64 */
      engineSeed: number | null
      limits: components['schemas']['PuzzleTrialLimits']
      /** Format: int64 */
      elapsedMillis: number
      decisions: components['schemas']['PuzzleTrialDecision'][]
      outcome: components['schemas']['PuzzleTrialOutcomeNullable']
      reason: string | null
    }
    /** ChallengeSummary */
    ChallengeSummary: {
      challengeId: string
      name: string
      objective: string
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
    /** CourseView */
    CourseView: {
      eventName: string
      module: string
      /** Format: int32 */
      wins: number
      /** Format: int32 */
      losses: number
      cardPool: number[]
      deckId: string | null
    }
    /** WebDeckCard */
    WebDeckCard: {
      /** Format: int32 */
      grpId: number
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
      /** Format: int32 */
      grpId: number
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
    /** StartDraftRequestInput */
    StartDraftRequestInput: {
      playerId: string
      eventName: string
    }
    /** DraftSessionView */
    DraftSessionView: {
      eventName: string
      status: string
      /** Format: int32 */
      packNumber: number
      /** Format: int32 */
      pickNumber: number
      draftPack: number[]
      pickedCards: number[]
    }
    /** PickDraftRequestInput */
    PickDraftRequestInput: {
      playerId: string
      eventName: string
      /** Format: int32 */
      cardId: number
    }
    /** SubmitDeckRequestInput */
    SubmitDeckRequestInput: {
      playerId: string
      eventName: string
      name?: string
      deckId?: string | null
      mainDeck: components['schemas']['WebDeckCardInput'][]
      sideboard?: components['schemas']['WebDeckCardInput'][]
    }
    /** PlayDraftRequestInput */
    PlayDraftRequestInput: {
      playerId: string
      eventName: string
    }
    /** LimitedSetArchetypeView */
    LimitedSetArchetypeView: {
      pair: string
      name: string
      strategy: string | null
    }
    /** LimitedSetView */
    LimitedSetView: {
      code: string
      name: string
      date: string | null
      type: string | null
      /** Format: int32 */
      cardCount: number | null
      description: string | null
      mechanics: string[] | null
      archetypes: components['schemas']['LimitedSetArchetypeView'][] | null
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
