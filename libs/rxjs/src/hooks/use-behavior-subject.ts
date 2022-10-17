import React from 'react'
import { BehaviorSubject } from 'rxjs'

export const useBehaviorSubject = <T>(behaviorSubject: BehaviorSubject<T>): T => {
    const [value, setValue] = React.useState(behaviorSubject.value)
    React.useEffect(() => {
        const subscription = behaviorSubject.subscribe(setValue)
        return () => {
            subscription.unsubscribe()
        }
    }, [behaviorSubject, setValue])
    return value
}
